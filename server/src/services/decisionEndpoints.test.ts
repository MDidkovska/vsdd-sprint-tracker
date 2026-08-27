/**
 * Full-stack integration tests for the leadership decision endpoints (task 7.9).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService},
 * {@link SubmitService} and {@link DecisionService} and the Fastify server, then
 * exercise `POST` / `GET /api/v1/updates/:versionId/decisions` with `inject`.
 *
 * Because the decision path is transactional (the decision append and the audit
 * append are one atomic unit), these tests run against an in-process MongoDB
 * REPLICA SET (`MongoMemoryReplSet`) — standalone MongoDB does not support
 * multi-document transactions. A docker-compose replica set can be used instead
 * via `MONGO_TEST_URI`.
 *
 * Covered:
 *  - a successful decision creates an append-only decision + audit event while
 *    the referenced submitted version stays immutable and its original
 *    leadership ask is untouched (R10.3, R14.1);
 *  - the audit event captures actor, timestamp and the DECISION_RECORDED action
 *    (R14.2);
 *  - multiple decisions can be recorded against one version and are returned
 *    oldest first;
 *  - a whitespace-only decision is rejected with 400 and changes nothing;
 *  - recording against an unknown version returns 404;
 *  - an unauthorised caller (not Programme Leadership) is rejected with 403,
 *    enforced server-side (R1 role matrix).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../auth/mockAuth.js';
import { mockAuthContext } from '../auth/mockAuth.js';
import type { LeadershipDecision, UpdateVersion } from '../domain/documents.js';
import type { CurrentUser } from '../domain/identity.js';
import { buildReferenceData, MOCK_CURRENT_USER } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DecisionService } from './decisionService.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { SubmitService } from './submitService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
/** A second server whose decision API runs as an unauthorised (Contributor) user. */
let unauthorisedApp: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_decision_test';

/** An auth context for a Contributor: assigned but lacking the LEADERSHIP role. */
const contributorAuth: AuthContext = {
  getCurrentUser(): CurrentUser {
    return {
      ...structuredClone(MOCK_CURRENT_USER),
      subject: 'user-contrib',
      roles: ['CONTRIBUTOR'],
      canViewAll: false,
    };
  },
};

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
  await repository.seedReferenceData(buildReferenceData());

  const drafts = new DraftService(repository, mockAuthContext);
  const submits = new SubmitService(repository, mockAuthContext);
  const decisions = new DecisionService(repository, mockAuthContext);
  app = buildServer(
    { checkReadiness: () => repository.ping(), drafts, submits, decisions },
    { logLevel: 'silent' },
  );

  unauthorisedApp = buildServer(
    { checkReadiness: () => repository.ping(), decisions: new DecisionService(repository, contributorAuth) },
    { logLevel: 'silent' },
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await unauthorisedApp?.close();
  await repository?.close();
  await replSet?.stop();
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
    exceptions: [
      {
        id: 'exc-1',
        type: 'RISK',
        impact: 'Regression coverage still incomplete.',
        owner: 'a.owner',
        dueDate: '2026-08-30',
        decisionSupport: 'Approve extra test capacity.',
        status: 'OPEN',
      },
    ],
    leadershipAsk: 'Need a decision on extending the hardening window.',
    ...overrides,
  };
}

/** Create a draft, submit it, and return the resulting immutable version. */
async function submitVersion(teamId: string, checkpointId: string): Promise<UpdateVersion> {
  const draftResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ revision: 0 }),
  });
  expect(draftResponse.statusCode).toBe(200);
  const draft = draftResponse.json() as { revision: number };

  const submitResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
    payload: draftBody({ revision: draft.revision }),
  });
  expect(submitResponse.statusCode).toBe(200);
  return (submitResponse.json() as { version: UpdateVersion }).version;
}

describe('POST /api/v1/updates/:versionId/decisions', () => {
  it('records a decision without editing the version or original ask, and appends an audit event', async () => {
    const teamId = 'mmm-a';
    const checkpointId = 'C14-1';
    const version = await submitVersion(teamId, checkpointId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/decisions`,
      payload: { decision: 'Approve a one-week extension of the hardening window.', dueDate: '2026-09-04' },
    });

    expect(response.statusCode).toBe(201);
    const decision = response.json() as LeadershipDecision;

    // The decision references the version, is OPEN, and records the leadership
    // actor as its owner (R10.3).
    expect(decision.updateVersionId).toBe(version.id);
    expect(decision.decision).toBe('Approve a one-week extension of the hardening window.');
    expect(decision.ownerSubject).toBe('user-md');
    expect(decision.dueDate).toBe('2026-09-04');
    expect(decision.status).toBe('OPEN');
    expect(Number.isNaN(Date.parse(decision.createdAt))).toBe(false);

    // R10.3 — the submitted version and the team's original leadership ask were
    // NOT mutated. The version stays immutable and its ask is unchanged.
    const priorVersion = await repository.getVersion(version.id);
    expect(priorVersion).toEqual(version);
    expect(priorVersion?.payload.leadershipAsk).toBe(
      'Need a decision on extending the hardening window.',
    );

    // The decision is retrievable and the append-only audit event captured the
    // actor, timestamp and DECISION_RECORDED action (R14.1, R14.2).
    const stored = await repository.getDecision(decision.id);
    expect(stored).toEqual(decision);
    const audit = await repository.listAudit(decision.id);
    const decisionEvent = audit.find((event) => event.action === 'DECISION_RECORDED');
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent?.entityType).toBe('DECISION');
    expect(decisionEvent?.entityId).toBe(decision.id);
    expect(decisionEvent?.actorSubject).toBe('user-md');
    expect(Number.isNaN(Date.parse(decisionEvent!.timestamp))).toBe(false);
  });

  it('records and lists multiple decisions against one version, oldest first', async () => {
    const teamId = 'mmm-b';
    const checkpointId = 'C14-1';
    const version = await submitVersion(teamId, checkpointId);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/decisions`,
      payload: { decision: 'First: gather more evidence.' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/decisions`,
      payload: { decision: 'Second: approve extra capacity.' },
    });
    expect(second.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${version.id}/decisions`,
    });
    expect(list.statusCode).toBe(200);
    const decisions = list.json() as LeadershipDecision[];
    expect(decisions).toHaveLength(2);
    expect(decisions.map((d) => d.decision)).toEqual([
      'First: gather more evidence.',
      'Second: approve extra capacity.',
    ]);
    // A decision without a due date omits the optional field.
    expect(decisions[0]?.dueDate).toBeUndefined();
  });

  it('rejects a whitespace-only decision with 400 and records nothing', async () => {
    const teamId = 'oah-ils';
    const checkpointId = 'C14-1';
    const version = await submitVersion(teamId, checkpointId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/decisions`,
      payload: { decision: '   ' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fieldErrors.map((e: { path: string }) => e.path)).toContain('decision');

    const decisions = await repository.listDecisions(version.id);
    expect(decisions).toHaveLength(0);
  });

  it('rejects recording against an unknown version with 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/does-not-exist-v9/decisions',
      payload: { decision: 'Attempting to decide on a phantom version.' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthorised caller (not Programme Leadership) with 403 and records nothing', async () => {
    const teamId = 'grmb';
    const checkpointId = 'C14-1';
    const version = await submitVersion(teamId, checkpointId);

    const response = await unauthorisedApp.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/decisions`,
      payload: { decision: 'Contributor tries to record a decision.' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');

    const decisions = await repository.listDecisions(version.id);
    expect(decisions).toHaveLength(0);
  });
});
