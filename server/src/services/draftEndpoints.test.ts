/**
 * Full-stack integration tests for the team-draft read/write endpoints
 * (task 7.4).
 *
 * These wire the REAL MongoDB adapter (via mongodb-memory-server, or a
 * docker-compose instance through MONGO_TEST_URI) to the real
 * {@link DraftService} and the Fastify server, then exercise the endpoints with
 * `inject`. They verify the whole slice: reading a MISSING placeholder, creating
 * and updating a draft, the revision increment on success, and the 409 conflict
 * on a stale revision that overwrites nothing (R11.5).
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mockAuthContext } from '../auth/mockAuth.js';
import type { UpdateDocument } from '../domain/documents.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';

let memoryServer: MongoMemoryServer | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_draft_test';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
  await repository.seedReferenceData(buildReferenceData());

  const drafts = new DraftService(repository, mockAuthContext);
  app = buildServer({ checkReadiness: () => repository.ping(), drafts }, { logLevel: 'silent' });
});

afterAll(async () => {
  await app?.close();
  await repository?.close();
  await memoryServer?.stop();
});

function draftBody(overrides: Partial<DraftUpdateRequest> = {}): DraftUpdateRequest {
  return {
    revision: 0,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    goals: {
      business: 'Enable the September release journey.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests.',
      nextWeekCommitment: 'Confirm readiness.',
    },
    qualityEvidence: { planned: 120, executed: 84, passed: 79, openCritical: 1, blocked: 5, automationPercent: 18 },
    achievements: 'Execution reached 70% of plan.',
    aiValue: {
      useCase: 'AI-assisted test generation',
      measurableBenefit: '27% reduction in design effort',
      humanValidation: 'Test lead review',
      nextExperimentConstraint: 'Extend with human approval',
    },
    exceptions: [],
    leadershipAsk: 'None',
    ...overrides,
  };
}

// Distinct teams per test keep aggregates isolated (no per-test cleanup needed).
describe('GET /api/v1/teams/:teamId/updates/:checkpointId', () => {
  it('returns a MISSING placeholder document when no draft exists', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/grmb/updates/C14-1',
    });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as UpdateDocument;
    expect(doc.state).toBe('MISSING');
    expect(doc.revision).toBe(0);
    expect(doc.sprintId).toBe('S14'); // resolved from the checkpoint
    expect(doc.streamId).toBe('GRMB'); // resolved from the team
    expect(doc.programmeId).toBe('vsdd');
    expect(response.headers.etag).toBe('"0"');
  });

  it('returns 404 for an unknown team', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/teams/nope/updates/C14-1' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 404 for an unknown checkpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/teams/mmm-a/updates/NOPE' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('PUT /api/v1/teams/:teamId/drafts/:checkpointId', () => {
  it('creates a draft from revision 0 and returns revision 1', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/mmm-a/drafts/C14-1',
      payload: draftBody({ revision: 0 }),
    });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as UpdateDocument;
    expect(doc.state).toBe('DRAFT');
    expect(doc.revision).toBe(1);
    expect(doc.updatedBy).toBe('user-md');
    expect(doc.payload.goals.business).toBe('Enable the September release journey.');
    expect(response.headers.etag).toBe('"1"');
  });

  it('reads back the persisted draft after creation', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/mmm-b/drafts/C14-1',
      payload: draftBody({ revision: 0, achievements: 'persisted content' }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/teams/mmm-b/updates/C14-1' });
    const doc = response.json() as UpdateDocument;
    expect(doc.state).toBe('DRAFT');
    expect(doc.revision).toBe(1);
    expect(doc.payload.achievements).toBe('persisted content');
  });

  it('increments the revision on each successful save', async () => {
    const first = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/oah-ils/drafts/C14-1',
      payload: draftBody({ revision: 0 }),
    });
    expect((first.json() as UpdateDocument).revision).toBe(1);

    const second = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/oah-ils/drafts/C14-1',
      payload: draftBody({ revision: 1, achievements: 'updated' }),
    });
    expect(second.statusCode).toBe(200);
    const doc = second.json() as UpdateDocument;
    expect(doc.revision).toBe(2);
    expect(doc.payload.achievements).toBe('updated');
  });

  it('derives envelope flags (hasBlocker / hasLeadershipAsk) from the payload', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/oah-sales/drafts/C14-1',
      payload: draftBody({
        revision: 0,
        leadershipAsk: 'Need a decision on vendor access.',
        exceptions: [
          {
            id: 'exc-1',
            type: 'BLOCKER',
            impact: 'Blocks regression sign-off.',
            owner: 'a.owner',
            dueDate: '2026-08-30',
            decisionSupport: 'Approve access request.',
            status: 'OPEN',
          },
        ],
      }),
    });
    const doc = response.json() as UpdateDocument;
    expect(doc.hasBlocker).toBe(true);
    expect(doc.hasLeadershipAsk).toBe(true);
  });

  it('rejects a stale revision with 409 and overwrites nothing (R11.5)', async () => {
    // Create at revision 0 -> 1.
    await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/o24-app/drafts/C14-1',
      payload: draftBody({ revision: 0, achievements: 'first content' }),
    });
    // A second writer advances 1 -> 2.
    await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/o24-app/drafts/C14-1',
      payload: draftBody({ revision: 1, achievements: 'second-writer content' }),
    });

    // The first writer still holds revision 1 -> conflict.
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/o24-app/drafts/C14-1',
      payload: draftBody({ revision: 1, achievements: 'stale overwrite attempt' }),
    });
    expect(stale.statusCode).toBe(409);
    const body = stale.json();
    expect(body).toMatchObject({
      error: { code: 'DRAFT_REVISION_CONFLICT', fieldErrors: [] },
      server: { revision: 2 },
    });
    expect(body.error.correlationId).toBeTruthy();

    // Nothing was overwritten: the second writer's content survives.
    const current = await app.inject({ method: 'GET', url: '/api/v1/teams/o24-app/updates/C14-1' });
    const doc = current.json() as UpdateDocument;
    expect(doc.revision).toBe(2);
    expect(doc.payload.achievements).toBe('second-writer content');
  });

  it('preserves createdAt across updates while advancing updatedAt', async () => {
    const created = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/visa/drafts/C14-1',
      payload: draftBody({ revision: 0 }),
    });
    const createdDoc = created.json() as UpdateDocument;

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/teams/visa/drafts/C14-1',
      payload: draftBody({ revision: 1, achievements: 'changed' }),
    });
    const updatedDoc = updated.json() as UpdateDocument;
    expect(updatedDoc.createdAt).toBe(createdDoc.createdAt);
  });
});
