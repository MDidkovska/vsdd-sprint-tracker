/**
 * Full-stack integration tests for the version history / audit / comparison
 * endpoints (task 7.8).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService},
 * {@link SubmitService}, {@link ReopenService} and {@link VersionService} and the
 * Fastify server, then exercise the §6 read endpoints with `inject`:
 *   GET /api/v1/teams/:teamId/updates/:checkpointId/versions
 *   GET /api/v1/updates/:versionId
 *   GET /api/v1/updates/:versionId/audit
 *   GET /api/v1/updates/:versionId/compare/:compareVersionId
 *
 * Because submit/reopen are transactional, these run against an in-process
 * MongoDB REPLICA SET (`MongoMemoryReplSet`) — standalone MongoDB does not
 * support multi-document transactions. A docker-compose replica set can be used
 * instead via `MONGO_TEST_URI`.
 *
 * Covered:
 *  - listing a team+checkpoint's versions newest first after a reopen+resubmit
 *    cycle retains BOTH immutable versions (R14.1);
 *  - fetching a single version by id, and 404 for an unknown id;
 *  - the audit trail for a version records the SUBMITTED action (R14.2);
 *  - comparing two versions field by field reports changed vs unchanged fields
 *    and added/removed exceptions (R14.3);
 *  - comparison error cases: unknown version (404), same version (400) and
 *    versions from different teams/checkpoints (400).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mockAuthContext } from '../auth/mockAuth.js';
import { docKey, type AuditEvent, type UpdateVersion } from '../domain/documents.js';
import type { VersionComparison } from '../domain/versionComparison.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DecisionService } from './decisionService.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { ReopenService } from './reopenService.js';
import { SubmitService } from './submitService.js';
import { VersionService } from './versionService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_version_test';

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
  const reopens = new ReopenService(repository, mockAuthContext);
  const versions = new VersionService(repository, mockAuthContext);
  const decisions = new DecisionService(repository, mockAuthContext);
  app = buildServer(
    { checkReadiness: () => repository.ping(), drafts, submits, reopens, versions, decisions },
    { logLevel: 'silent' },
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
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

/** Save a draft (rev 0) and submit it, returning the resulting immutable version. */
async function submitFirstVersion(
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest> = {},
): Promise<UpdateVersion> {
  const draftResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ ...overrides, revision: 0 }),
  });
  expect(draftResponse.statusCode).toBe(200);
  const draft = draftResponse.json() as { revision: number };

  const submitResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
    payload: draftBody({ ...overrides, revision: draft.revision }),
  });
  expect(submitResponse.statusCode).toBe(200);
  return (submitResponse.json() as { version: UpdateVersion }).version;
}

/** Reopen a submitted version and resubmit changed content, returning the new version. */
async function reopenAndResubmit(
  version: UpdateVersion,
  changed: Partial<DraftUpdateRequest>,
): Promise<UpdateVersion> {
  const reopenResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/updates/${version.id}/reopen`,
    payload: { reason: 'Correcting the submitted content.' },
  });
  expect(reopenResponse.statusCode).toBe(200);
  const reopened = reopenResponse.json() as { revision: number };

  const submitResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${version.teamId}/drafts/${version.checkpointId}/submit`,
    payload: draftBody({ ...changed, revision: reopened.revision }),
  });
  expect(submitResponse.statusCode).toBe(200);
  return (submitResponse.json() as { version: UpdateVersion }).version;
}

describe('GET /api/v1/teams/:teamId/updates/:checkpointId/versions', () => {
  it('lists all retained versions newest first after a reopen + resubmit', async () => {
    const teamId = 'mmm-a';
    const checkpointId = 'C14-1';
    const v1 = await submitFirstVersion(teamId, checkpointId);
    const v2 = await reopenAndResubmit(v1, { rag: { business: 'RED', delivery: 'AMBER', release: 'AMBER' } });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/updates/${checkpointId}/versions`,
    });
    expect(response.statusCode).toBe(200);
    const versions = response.json() as UpdateVersion[];

    // Both immutable versions are retained (R14.1), newest first.
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(versions[0]?.id).toBe(v2.id);
    expect(versions[1]?.id).toBe(v1.id);
  });

  it('returns 404 for an unknown team', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/no-such-team/updates/C14-1/versions',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for an unknown checkpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/mmm-a/updates/no-such-checkpoint/versions',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/updates/:versionId', () => {
  it('fetches a single immutable version by id', async () => {
    const version = await submitFirstVersion('mmm-b', 'C14-1');

    const response = await app.inject({ method: 'GET', url: `/api/v1/updates/${version.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json() as UpdateVersion).toEqual(version);
  });

  it('returns 404 for an unknown version id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/updates/does-not-exist-v9' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/updates/:versionId/audit', () => {
  it('returns the append-only audit trail recording the SUBMITTED action', async () => {
    const version = await submitFirstVersion('oah-ils', 'C14-1');

    const response = await app.inject({ method: 'GET', url: `/api/v1/updates/${version.id}/audit` });
    expect(response.statusCode).toBe(200);
    const events = response.json() as AuditEvent[];

    const submitted = events.find((e) => e.action === 'SUBMITTED');
    expect(submitted).toBeDefined();
    expect(submitted?.entityType).toBe('VERSION');
    expect(submitted?.entityId).toBe(version.id);
    expect(submitted?.actorSubject).toBe('user-md');
    expect(Number.isNaN(Date.parse(submitted!.timestamp))).toBe(false);
  });

  it('returns 404 for an unknown version rather than an empty list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/updates/does-not-exist-v9/audit',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('returns one unified newest-first history across submit, reopen, resubmit and decision', async () => {
    // Use an assigned team + a checkpoint not used by other tests in this file
    // so the aggregate's audit trail is exactly this scenario's four events.
    const teamId = 'oah-sales';
    const checkpointId = 'C14-2';

    // submit v1 -> reopen -> resubmit v2 -> record a decision on v2.
    const v1 = await submitFirstVersion(teamId, checkpointId);
    const v2 = await reopenAndResubmit(v1, { achievements: 'Corrected the numbers.' });

    const decisionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${v2.id}/decisions`,
      payload: { decision: 'Approve the correction.' },
    });
    expect(decisionResponse.statusCode).toBe(201);

    // The audit endpoint returns the WHOLE update history whether queried by the
    // first or the latest version id — one unified trail, newest first.
    const viaV1 = (
      await app.inject({ method: 'GET', url: `/api/v1/updates/${v1.id}/audit` })
    ).json() as AuditEvent[];
    const viaV2 = (
      await app.inject({ method: 'GET', url: `/api/v1/updates/${v2.id}/audit` })
    ).json() as AuditEvent[];

    // Both entry points resolve to the same aggregate history.
    expect(viaV1.map((e) => e.id)).toEqual(viaV2.map((e) => e.id));

    // Four lifecycle events, newest first: decision, resubmit, reopen, submit.
    expect(viaV1.map((e) => e.action)).toEqual([
      'DECISION_RECORDED',
      'SUBMITTED',
      'REOPENED',
      'SUBMITTED',
    ]);

    // Newest-first is also monotonically non-increasing by timestamp.
    for (let i = 1; i < viaV1.length; i += 1) {
      expect(Date.parse(viaV1[i - 1]!.timestamp)).toBeGreaterThanOrEqual(
        Date.parse(viaV1[i]!.timestamp),
      );
    }

    // Every event shares the one stable aggregate id, and there are no
    // duplicate audit ids (append-only, no duplication).
    const aggregateId = docKey(teamId, v1.sprintId, checkpointId);
    expect(viaV1.every((e) => e.aggregateId === aggregateId)).toBe(true);
    expect(new Set(viaV1.map((e) => e.id)).size).toBe(viaV1.length);
  });

  it('does not mutate or duplicate the audit trail when read repeatedly', async () => {
    const teamId = 'grmb';
    const checkpointId = 'C14-2';
    const version = await submitFirstVersion(teamId, checkpointId);

    const first = (
      await app.inject({ method: 'GET', url: `/api/v1/updates/${version.id}/audit` })
    ).json() as AuditEvent[];
    const second = (
      await app.inject({ method: 'GET', url: `/api/v1/updates/${version.id}/audit` })
    ).json() as AuditEvent[];

    // Reading the audit trail is a pure read — identical results, no growth.
    expect(second).toEqual(first);
    expect(second).toHaveLength(first.length);
  });
});

describe('GET /api/v1/updates/:versionId/compare/:compareVersionId', () => {
  it('produces a field-by-field diff with changed/unchanged fields and exception changes', async () => {
    const teamId = 'grmb';
    const checkpointId = 'C14-1';
    const v1 = await submitFirstVersion(teamId, checkpointId);
    // v2 changes the business RAG and an executed count, removes exc-1 and adds exc-2.
    const v2 = await reopenAndResubmit(v1, {
      rag: { business: 'RED', delivery: 'AMBER', release: 'AMBER' },
      qualityEvidence: { planned: 120, executed: 100, passed: 79, openCritical: 1, blocked: 5, automationPercent: 18 },
      exceptions: [
        {
          id: 'exc-2',
          type: 'BLOCKER',
          impact: 'Environment outage blocks execution.',
          owner: 'b.owner',
          dueDate: '2026-09-02',
          decisionSupport: 'Escalate to platform team.',
          status: 'OPEN',
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${v1.id}/compare/${v2.id}`,
    });
    expect(response.statusCode).toBe(200);
    const comparison = response.json() as VersionComparison;

    // Direction is fixed by versionNumber (previous = v1, current = v2).
    expect(comparison.previous.versionId).toBe(v1.id);
    expect(comparison.current.versionId).toBe(v2.id);
    expect(comparison.hasChanges).toBe(true);

    // A changed scalar field carries previous + current values.
    const businessRag = comparison.fields.find((f) => f.path === 'rag.business');
    expect(businessRag).toMatchObject({ previous: 'GREEN', current: 'RED', changed: true });
    const executed = comparison.fields.find((f) => f.path === 'qualityEvidence.executed');
    expect(executed).toMatchObject({ previous: 84, current: 100, changed: true });

    // An unchanged field is reported but not flagged.
    const businessGoal = comparison.fields.find((f) => f.path === 'goals.business');
    expect(businessGoal?.changed).toBe(false);

    // Exceptions are reconciled by id: exc-1 removed, exc-2 added.
    expect(comparison.exceptions.find((e) => e.id === 'exc-1')?.changeType).toBe('REMOVED');
    expect(comparison.exceptions.find((e) => e.id === 'exc-2')?.changeType).toBe('ADDED');
    expect(comparison.changedPaths).toEqual(
      expect.arrayContaining(['rag.business', 'qualityEvidence.executed', 'exceptions.exc-1', 'exceptions.exc-2']),
    );
  });

  it('orders previous/current by versionNumber regardless of path order', async () => {
    const teamId = 'oah-sales';
    const checkpointId = 'C14-1';
    const v1 = await submitFirstVersion(teamId, checkpointId);
    const v2 = await reopenAndResubmit(v1, { achievements: 'Execution reached 90% of plan.' });

    // Supply the newer id first; the service must still put v1 as previous.
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${v2.id}/compare/${v1.id}`,
    });
    expect(response.statusCode).toBe(200);
    const comparison = response.json() as VersionComparison;
    expect(comparison.previous.versionId).toBe(v1.id);
    expect(comparison.current.versionId).toBe(v2.id);
    expect(comparison.fields.find((f) => f.path === 'achievements')).toMatchObject({
      previous: 'Execution reached 70% of plan.',
      current: 'Execution reached 90% of plan.',
      changed: true,
    });
  });

  it('returns 404 when one of the versions is unknown', async () => {
    const version = await submitFirstVersion('o24-app', 'C14-1');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${version.id}/compare/does-not-exist-v9`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects comparing a version with itself (400)', async () => {
    const version = await submitFirstVersion('visa', 'C14-1');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${version.id}/compare/${version.id}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects comparing versions from different teams (400)', async () => {
    const a = await submitFirstVersion('mmm-a', 'C14-2');
    const b = await submitFirstVersion('mmm-b', 'C14-2');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/updates/${a.id}/compare/${b.id}`,
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fieldErrors.map((e: { path: string }) => e.path)).toContain('compareVersionId');
  });
});
