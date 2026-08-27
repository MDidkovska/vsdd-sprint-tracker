/**
 * Unit tests for the authorised reopen route (task 7.6).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link ReopenApi}, verifying routing, body validation, the ETag revision
 * header and error-envelope mapping in isolation from MongoDB. Full-stack
 * behaviour against a real (transactional) store is covered by
 * reopenEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  type UpdateDocument,
} from '../domain/documents.js';
import { ApiError, DraftRevisionConflictError } from '../http/errorEnvelope.js';
import type { ReopenApi } from '../services/reopenService.js';
import { buildServer } from '../server.js';

function makeReopenedDoc(overrides: Partial<UpdateDocument> = {}): UpdateDocument {
  const now = '2026-08-26T09:14:00Z';
  return {
    id: 'mmm-a|S14|C14-1',
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    state: 'REOPENED',
    revision: 3,
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

function fakeApi(overrides: Partial<ReopenApi> = {}): ReopenApi {
  return {
    reopen: async (): Promise<UpdateDocument> => makeReopenedDoc(),
    ...overrides,
  };
}

function build(api: ReopenApi) {
  return buildServer({ checkReadiness: async () => true, reopens: api }, { logLevel: 'silent' });
}

describe('authorised reopen route', () => {
  it('POST /updates/:versionId/reopen returns the REOPENED document with a revision ETag', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: { reason: 'Correcting the executed count.' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ state: 'REOPENED', revision: 3 });
    expect(response.headers.etag).toBe('"3"');
    await app.close();
  });

  it('passes the versionId and reason through to the API', async () => {
    let seen = { versionId: '', reason: '' };
    const app = build(
      fakeApi({
        reopen: async (versionId, request) => {
          seen = { versionId, reason: request.reason };
          return makeReopenedDoc();
        },
      }),
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/updates/oah-ils-S14-C14-1-v2/reopen',
      payload: { reason: 'Fixing the metrics.' },
    });
    expect(seen).toEqual({ versionId: 'oah-ils-S14-C14-1-v2', reason: 'Fixing the metrics.' });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for a missing reason (schema)', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for an empty reason (schema minLength)', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: { reason: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('maps a whitespace-only reason ApiError to a 400 envelope with a field error', async () => {
    const app = build(
      fakeApi({
        reopen: async () => {
          throw ApiError.validation('A reason is required to reopen a submitted update.', [
            { path: 'reason', message: 'Enter why this submitted update is being reopened.' },
          ]);
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: { reason: '   ' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fieldErrors).toContainEqual({
      path: 'reason',
      message: 'Enter why this submitted update is being reopened.',
    });
    await app.close();
  });

  it('maps a NOT_FOUND ApiError to a 404 envelope', async () => {
    const app = build(
      fakeApi({
        reopen: async () => {
          throw ApiError.notFound('Submitted version "nope" was not found.');
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/nope/reopen',
      payload: { reason: 'x' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });

  it('maps a PERMISSION_DENIED ApiError to a 403 envelope', async () => {
    const app = build(
      fakeApi({
        reopen: async () => {
          throw new ApiError('PERMISSION_DENIED', 'Only an assigned Team Lead can reopen a submitted update.');
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: { reason: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    await app.close();
  });

  it('maps a concurrent-edit conflict to a 409 envelope with server metadata', async () => {
    const app = build(
      fakeApi({
        reopen: async () => {
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
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: { reason: 'x' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'DRAFT_REVISION_CONFLICT', fieldErrors: [] },
      server: { revision: 7, updatedBy: 'another.user' },
    });
    await app.close();
  });

  it('does not register the reopen route when no reopen API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/reopen',
      payload: { reason: 'x' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
