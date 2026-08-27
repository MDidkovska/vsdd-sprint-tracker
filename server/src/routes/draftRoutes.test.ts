/**
 * Unit tests for the team-draft read/write routes (task 7.4).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link DraftApi}, verifying routing, body validation, the ETag revision
 * header and error-envelope mapping in isolation from MongoDB. Full-stack
 * behaviour against a real store is covered by draftEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  type UpdateDocument,
} from '../domain/documents.js';
import { ApiError, DraftRevisionConflictError } from '../http/errorEnvelope.js';
import type { DraftApi, DraftUpdateRequest } from '../services/draftService.js';
import { buildServer } from '../server.js';

function makeDoc(overrides: Partial<UpdateDocument> = {}): UpdateDocument {
  const now = '2026-08-26T09:14:00Z';
  return {
    id: 'mmm-a|S14|C14-1',
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    state: 'DRAFT',
    revision: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'user-md',
    payload: {
      goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
      qualityEvidence: { planned: 10, executed: 5, passed: 4, openCritical: 0, blocked: 1, automationPercent: 20 },
      achievements: 'a',
      aiValue: { useCase: 'u', measurableBenefit: 'm', humanValidation: 'h', nextExperimentConstraint: 'x' },
      exceptions: [],
      leadershipAsk: 'None',
      statusRationale: '',
      metricsNote: '',
    },
    ...overrides,
  };
}

function validBody(overrides: Partial<DraftUpdateRequest> = {}): DraftUpdateRequest {
  return {
    revision: 1,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
    qualityEvidence: { planned: 10, executed: 5, passed: 4, openCritical: 0, blocked: 1, automationPercent: 20 },
    achievements: 'a',
    aiValue: { useCase: 'u', measurableBenefit: 'm', humanValidation: 'h', nextExperimentConstraint: 'x' },
    exceptions: [],
    leadershipAsk: 'None',
    ...overrides,
  };
}

function fakeApi(overrides: Partial<DraftApi> = {}): DraftApi {
  return {
    getUpdate: async () => makeDoc(),
    saveDraft: async (_teamId, _checkpointId, request) =>
      makeDoc({ revision: request.revision + 1 }),
    ...overrides,
  };
}

function build(api: DraftApi) {
  return buildServer({ checkReadiness: async () => true, drafts: api }, { logLevel: 'silent' });
}

describe('team-draft read/write routes', () => {
  it('GET /teams/:id/updates/:cp returns the current document with a revision ETag', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/mmm-a/updates/C14-1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'mmm-a|S14|C14-1', revision: 1, state: 'DRAFT' });
    expect(response.headers.etag).toBe('"1"');
    await app.close();
  });

  it('passes the path params through to the API', async () => {
    let seen = { teamId: '', checkpointId: '' };
    const app = build(
      fakeApi({
        getUpdate: async (teamId, checkpointId) => {
          seen = { teamId, checkpointId };
          return makeDoc();
        },
      }),
    );
    await app.inject({ method: 'GET', url: '/api/v1/teams/oah-ils/updates/C14-2' });
    expect(seen).toEqual({ teamId: 'oah-ils', checkpointId: 'C14-2' });
    await app.close();
  });

  it('maps a NOT_FOUND ApiError from getUpdate to a 404 envelope', async () => {
    const app = build(
      fakeApi({
        getUpdate: async () => {
          throw ApiError.notFound('Team "nope" was not found.');
        },
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/teams/nope/updates/C14-1' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND', fieldErrors: [] } });
    await app.close();
  });

  it('PUT /teams/:id/drafts/:cp saves and returns the new revision + ETag', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/mmm-a/drafts/C14-1',
      payload: validBody({ revision: 3 }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ revision: 4 });
    expect(response.headers.etag).toBe('"4"');
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for a malformed body (missing required field)', async () => {
    const app = build(fakeApi());
    const { revision: _drop, ...withoutRevision } = validBody();
    void _drop;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/mmm-a/drafts/C14-1',
      payload: withoutRevision,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(body.error.correlationId).toBeTruthy();
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for an invalid RAG value', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/mmm-a/drafts/C14-1',
      payload: { ...validBody(), rag: { business: 'PURPLE', delivery: 'AMBER', release: 'RED' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('maps a stale-revision conflict to a 409 envelope with server metadata', async () => {
    const app = build(
      fakeApi({
        saveDraft: async () => {
          throw new DraftRevisionConflictError({
            revision: 7,
            updatedAt: '2026-08-26T10:00:00Z',
            updatedBy: 'another.user',
          });
        },
      }),
    );
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/mmm-a/drafts/C14-1',
      payload: validBody({ revision: 5 }),
    });
    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body).toMatchObject({
      error: { code: 'DRAFT_REVISION_CONFLICT', fieldErrors: [] },
      server: { revision: 7, updatedBy: 'another.user', updatedAt: '2026-08-26T10:00:00Z' },
    });
    expect(body.error.correlationId).toBeTruthy();
    await app.close();
  });

  it('does not register draft routes when no draft API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/teams/mmm-a/updates/C14-1' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
