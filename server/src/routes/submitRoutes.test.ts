/**
 * Unit tests for the atomic submit route (task 7.5).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link SubmitApi}, verifying routing, body validation, the ETag revision
 * header and error-envelope mapping in isolation from MongoDB. Full-stack
 * behaviour against a real (transactional) store is covered by
 * submitEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  type UpdateDocument,
  type UpdateVersion,
} from '../domain/documents.js';
import { ApiError, DraftRevisionConflictError } from '../http/errorEnvelope.js';
import type { DraftUpdateRequest } from '../services/draftService.js';
import type { SubmitApi, SubmitResult } from '../services/submitService.js';
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
    state: 'SUBMITTED',
    revision: 2,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'user-md',
    submittedAt: now,
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

function makeVersion(): UpdateVersion {
  const now = '2026-08-26T09:14:00Z';
  return {
    id: 'mmm-a-S14-C14-1-v1',
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber: 1,
    submittedBy: 'user-md',
    submittedAt: now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: makeDoc().payload,
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

function fakeApi(overrides: Partial<SubmitApi> = {}): SubmitApi {
  return {
    submit: async (): Promise<SubmitResult> => ({ document: makeDoc(), version: makeVersion() }),
    ...overrides,
  };
}

function build(api: SubmitApi) {
  return buildServer({ checkReadiness: async () => true, submits: api }, { logLevel: 'silent' });
}

describe('atomic submit route', () => {
  it('POST /teams/:id/drafts/:cp/submit returns { document, version } with a revision ETag', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/mmm-a/drafts/C14-1/submit',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.document).toMatchObject({ state: 'SUBMITTED', revision: 2 });
    expect(body.version).toMatchObject({ id: 'mmm-a-S14-C14-1-v1', versionNumber: 1 });
    expect(response.headers.etag).toBe('"2"');
    await app.close();
  });

  it('passes the path params through to the API', async () => {
    let seen = { teamId: '', checkpointId: '' };
    const app = build(
      fakeApi({
        submit: async (teamId, checkpointId) => {
          seen = { teamId, checkpointId };
          return { document: makeDoc(), version: makeVersion() };
        },
      }),
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/teams/oah-ils/drafts/C14-2/submit',
      payload: validBody(),
    });
    expect(seen).toEqual({ teamId: 'oah-ils', checkpointId: 'C14-2' });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for a malformed body (missing required field)', async () => {
    const app = build(fakeApi());
    const { revision: _drop, ...withoutRevision } = validBody();
    void _drop;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/mmm-a/drafts/C14-1/submit',
      payload: withoutRevision,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('maps a submission validation ApiError to a 400 envelope with field errors', async () => {
    const app = build(
      fakeApi({
        submit: async () => {
          throw ApiError.validation('This update is missing required information.', [
            { path: 'achievements', message: 'Describe what changed against this week’s commitment.' },
          ]);
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/mmm-a/drafts/C14-1/submit',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fieldErrors).toContainEqual({
      path: 'achievements',
      message: 'Describe what changed against this week’s commitment.',
    });
    await app.close();
  });

  it('maps an ALREADY_SUBMITTED ApiError to a 409 envelope', async () => {
    const app = build(
      fakeApi({
        submit: async () => {
          throw new ApiError('ALREADY_SUBMITTED', 'This update is submitted and immutable.');
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/mmm-a/drafts/C14-1/submit',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'ALREADY_SUBMITTED' } });
    await app.close();
  });

  it('maps a stale-revision conflict to a 409 envelope with server metadata', async () => {
    const app = build(
      fakeApi({
        submit: async () => {
          throw new DraftRevisionConflictError({
            revision: 7,
            updatedAt: '2026-08-26T10:00:00Z',
            updatedBy: 'another.user',
          });
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/mmm-a/drafts/C14-1/submit',
      payload: validBody({ revision: 5 }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'DRAFT_REVISION_CONFLICT', fieldErrors: [] },
      server: { revision: 7, updatedBy: 'another.user' },
    });
    await app.close();
  });

  it('does not register the submit route when no submit API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams/mmm-a/drafts/C14-1/submit',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
