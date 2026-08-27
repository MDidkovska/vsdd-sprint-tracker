/**
 * Unit tests for the leadership decision routes (task 7.9).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link DecisionApi}, verifying routing, body validation, the 201 status on
 * create and error-envelope mapping in isolation from MongoDB. Full-stack
 * behaviour against a real (transactional) store is covered by
 * decisionEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { LeadershipDecision } from '../domain/documents.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { DecisionApi } from '../services/decisionService.js';
import { buildServer } from '../server.js';

function makeDecision(overrides: Partial<LeadershipDecision> = {}): LeadershipDecision {
  return {
    id: 'decision-1',
    updateVersionId: 'mmm-a-S14-C14-1-v1',
    decision: 'Approve additional test capacity for the next sprint.',
    ownerSubject: 'user-md',
    dueDate: '2026-09-04',
    status: 'OPEN',
    createdAt: '2026-08-26T09:14:00Z',
    ...overrides,
  };
}

function fakeApi(overrides: Partial<DecisionApi> = {}): DecisionApi {
  return {
    recordDecision: async (): Promise<LeadershipDecision> => makeDecision(),
    getDecisions: async (): Promise<LeadershipDecision[]> => [makeDecision()],
    ...overrides,
  };
}

function build(api: DecisionApi) {
  return buildServer({ checkReadiness: async () => true, decisions: api }, { logLevel: 'silent' });
}

describe('leadership decision routes', () => {
  it('POST /updates/:versionId/decisions returns the recorded decision with a 201 status', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
      payload: { decision: 'Approve additional test capacity.' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: 'decision-1',
      updateVersionId: 'mmm-a-S14-C14-1-v1',
      status: 'OPEN',
    });
    await app.close();
  });

  it('passes the versionId and body through to the API', async () => {
    let seen: { versionId: string; decision: string; dueDate?: string } = {
      versionId: '',
      decision: '',
    };
    const app = build(
      fakeApi({
        recordDecision: async (versionId, request) => {
          seen = { versionId, decision: request.decision, dueDate: request.dueDate };
          return makeDecision();
        },
      }),
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/updates/oah-ils-S14-C14-1-v2/decisions',
      payload: { decision: 'Escalate the blocker to the vendor.', dueDate: '2026-09-01' },
    });
    expect(seen).toEqual({
      versionId: 'oah-ils-S14-C14-1-v2',
      decision: 'Escalate the blocker to the vendor.',
      dueDate: '2026-09-01',
    });
    await app.close();
  });

  it('GET /updates/:versionId/decisions returns the recorded decisions', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ updateVersionId: 'mmm-a-S14-C14-1-v1' });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for a missing decision (schema)', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for an empty decision (schema minLength)', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
      payload: { decision: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('maps a whitespace-only decision ApiError to a 400 envelope with a field error', async () => {
    const app = build(
      fakeApi({
        recordDecision: async () => {
          throw ApiError.validation('A decision is required.', [
            { path: 'decision', message: 'Enter the decision to record against this ask.' },
          ]);
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
      payload: { decision: '   ' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fieldErrors).toContainEqual({
      path: 'decision',
      message: 'Enter the decision to record against this ask.',
    });
    await app.close();
  });

  it('maps a NOT_FOUND ApiError to a 404 envelope', async () => {
    const app = build(
      fakeApi({
        recordDecision: async () => {
          throw ApiError.notFound('Submitted version "nope" was not found.');
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/nope/decisions',
      payload: { decision: 'x' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });

  it('maps a PERMISSION_DENIED ApiError to a 403 envelope', async () => {
    const app = build(
      fakeApi({
        recordDecision: async () => {
          throw new ApiError('PERMISSION_DENIED', 'Only Programme Leadership can record a decision.');
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
      payload: { decision: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    await app.close();
  });

  it('does not register the decision routes when no decision API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/mmm-a-S14-C14-1-v1/decisions',
      payload: { decision: 'x' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
