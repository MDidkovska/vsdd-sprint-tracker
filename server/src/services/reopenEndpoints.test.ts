/**
 * Full-stack integration tests for the authorised reopen endpoint (task 7.6).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService},
 * {@link SubmitService} and {@link ReopenService} and the Fastify server, then
 * exercise `POST /api/v1/updates/:versionId/reopen` with `inject`.
 *
 * Because the reopen path is transactional (the SUBMITTED -> REOPENED draft
 * transition and the audit append are one atomic unit), these tests run against
 * an in-process MongoDB REPLICA SET (`MongoMemoryReplSet`) — standalone MongoDB
 * does not support multi-document transactions. A docker-compose replica set can
 * be used instead via `MONGO_TEST_URI`.
 *
 * Covered:
 *  - a successful reopen creates a new editable REOPENED draft + audit event
 *    while the prior submitted version stays immutable (R2.3, R11.3, R11.4);
 *  - the audit event captures actor, timestamp, reason, previous and new
 *    version (R14.1, R14.2);
 *  - a whitespace-only reason is rejected with 400 and changes nothing (R11.4);
 *  - reopening an unknown version returns 404;
 *  - a second reopen while already REOPENED is a 409 INVALID_STATE that changes
 *    nothing;
 *  - reopening an older, superseded version after a newer submission exists is a
 *    409 INVALID_STATE that changes nothing;
 *  - an unauthorised caller (not a Team Lead) is rejected with 403, enforced
 *    server-side (R1.4).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../auth/mockAuth.js';
import { mockAuthContext } from '../auth/mockAuth.js';
import { docKey, type UpdateDocument, type UpdateVersion } from '../domain/documents.js';
import type { CurrentUser } from '../domain/identity.js';
import { buildReferenceData, MOCK_CURRENT_USER } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { ReopenService } from './reopenService.js';
import { SubmitService } from './submitService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
/** A second server whose reopen API runs as an unauthorised (Contributor) user. */
let unauthorisedApp: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_reopen_test';

/** An auth context for a Contributor: assigned but lacking the TEAM_LEAD role. */
const contributorAuth: AuthContext = {
  getCurrentUser(): CurrentUser {
    return {
      ...structuredClone(MOCK_CURRENT_USER),
      subject: 'user-contrib',
      roles: ['CONTRIBUTOR'],
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
  const reopens = new ReopenService(repository, mockAuthContext);
  app = buildServer(
    { checkReadiness: () => repository.ping(), drafts, submits, reopens },
    { logLevel: 'silent' },
  );

  unauthorisedApp = buildServer(
    { checkReadiness: () => repository.ping(), reopens: new ReopenService(repository, contributorAuth) },
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
    leadershipAsk: 'None',
    ...overrides,
  };
}

/** Create a draft, submit it, and return the resulting immutable version. */
async function submitVersion(
  teamId: string,
  checkpointId: string,
): Promise<{ version: UpdateVersion; document: UpdateDocument }> {
  const draftResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ revision: 0 }),
  });
  expect(draftResponse.statusCode).toBe(200);
  const draft = draftResponse.json() as UpdateDocument;

  const submitResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
    payload: draftBody({ revision: draft.revision }),
  });
  expect(submitResponse.statusCode).toBe(200);
  return submitResponse.json() as { version: UpdateVersion; document: UpdateDocument };
}

describe('POST /api/v1/updates/:versionId/reopen', () => {
  it('reopens into a new editable REOPENED draft, appends an audit event and leaves the prior version immutable', async () => {
    const teamId = 'mmm-a';
    const checkpointId = 'C14-1';
    const { version, document: submitted } = await submitVersion(teamId, checkpointId);

    const reason = 'Correcting the executed count after a re-run.';
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/reopen`,
      payload: { reason },
    });

    expect(response.statusCode).toBe(200);
    const doc = response.json() as UpdateDocument;

    // A new editable draft in the REOPENED state, revision advanced past the
    // submitted envelope, seeded from the submitted version's content.
    expect(doc.state).toBe('REOPENED');
    expect(doc.revision).toBe(submitted.revision + 1);
    expect(doc.payload.goals.business).toBe(version.payload.goals.business);
    expect(response.headers.etag).toBe(`"${doc.revision}"`);

    // The stored aggregate is REOPENED and editable now.
    const id = docKey(teamId, version.sprintId, checkpointId);
    const stored = await repository.getDraft(id);
    expect(stored?.state).toBe('REOPENED');

    // The prior submitted version was NOT mutated or deleted — still immutable
    // and visible with unchanged content (R11.4).
    const priorVersion = await repository.getVersion(version.id);
    expect(priorVersion).not.toBeNull();
    expect(priorVersion).toEqual(version);
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(1);

    // The append-only audit event captured actor, timestamp, reason, previous
    // and new version (R14.1, R14.2).
    const audit = await repository.listAudit(id);
    const reopenEvent = audit.find((event) => event.action === 'REOPENED');
    expect(reopenEvent).toBeDefined();
    expect(reopenEvent?.actorSubject).toBe('user-md');
    expect(reopenEvent?.reason).toBe(reason);
    expect(reopenEvent?.previousVersion).toBe(version.versionNumber);
    expect(reopenEvent?.newVersion).toBe(doc.revision);
    expect(typeof reopenEvent?.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(reopenEvent!.timestamp))).toBe(false);
  });

  it('lets the reopened draft be edited and resubmitted, retaining both immutable versions', async () => {
    const teamId = 'mmm-b';
    const checkpointId = 'C14-1';
    const { version } = await submitVersion(teamId, checkpointId);

    const reopenResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/reopen`,
      payload: { reason: 'Revising the ask.' },
    });
    expect(reopenResponse.statusCode).toBe(200);
    const reopened = reopenResponse.json() as UpdateDocument;

    // Edit under the optimistic-concurrency guard: the draft stays REOPENED.
    const editResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: reopened.revision, achievements: 'Revised achievements.' }),
    });
    expect(editResponse.statusCode).toBe(200);
    const edited = editResponse.json() as UpdateDocument;
    expect(edited.state).toBe('REOPENED');

    // Resubmit -> a second immutable version; the first remains retained.
    const resubmit = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: edited.revision, achievements: 'Revised achievements.' }),
    });
    expect(resubmit.statusCode).toBe(200);
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });

  it('rejects a whitespace-only reason with 400 and changes nothing', async () => {
    const teamId = 'oah-ils';
    const checkpointId = 'C14-1';
    const { version } = await submitVersion(teamId, checkpointId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/reopen`,
      payload: { reason: '   ' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fieldErrors.map((e: { path: string }) => e.path)).toContain('reason');

    // The aggregate is still SUBMITTED (unchanged) and no reopen audit exists.
    const id = docKey(teamId, version.sprintId, checkpointId);
    const stored = await repository.getDraft(id);
    expect(stored?.state).toBe('SUBMITTED');
    const audit = await repository.listAudit(id);
    expect(audit.some((event) => event.action === 'REOPENED')).toBe(false);
  });

  it('rejects reopening an unknown version with 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/updates/does-not-exist-v9/reopen',
      payload: { reason: 'Attempting to reopen a phantom version.' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('rejects a SECOND reopen while already REOPENED with 409 INVALID_STATE and changes nothing', async () => {
    const teamId = 'o24-app';
    const checkpointId = 'C14-1';
    const { version } = await submitVersion(teamId, checkpointId);

    // First reopen succeeds -> the aggregate is now REOPENED.
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/reopen`,
      payload: { reason: 'First, legitimate reopen.' },
    });
    expect(first.statusCode).toBe(200);
    const reopened = first.json() as UpdateDocument;

    // A second reopen of the same version must be rejected: it is already open.
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/reopen`,
      payload: { reason: 'Second, invalid reopen.' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('INVALID_STATE');

    // Revision, state and audit are unchanged by the rejected second reopen.
    const id = docKey(teamId, version.sprintId, checkpointId);
    const stored = await repository.getDraft(id);
    expect(stored?.state).toBe('REOPENED');
    expect(stored?.revision).toBe(reopened.revision);
    const audit = await repository.listAuditForAggregate(id);
    expect(audit.filter((e) => e.action === 'REOPENED')).toHaveLength(1);
  });

  it('rejects reopening an OLDER version after a newer submission exists with 409 and changes nothing', async () => {
    const teamId = 'o24-app';
    const checkpointId = 'C14-2';
    const { version: v1 } = await submitVersion(teamId, checkpointId);

    // Reopen v1, edit, and resubmit -> v2 becomes the latest submitted version.
    const reopenV1 = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${v1.id}/reopen`,
      payload: { reason: 'Reopen to correct.' },
    });
    expect(reopenV1.statusCode).toBe(200);
    const reopened = reopenV1.json() as UpdateDocument;

    const resubmit = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: reopened.revision, achievements: 'Corrected achievements.' }),
    });
    expect(resubmit.statusCode).toBe(200);
    const v2 = (resubmit.json() as { version: UpdateVersion }).version;
    expect(v2.versionNumber).toBe(2);

    // Attempting to reopen the SUPERSEDED v1 must be rejected.
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${v1.id}/reopen`,
      payload: { reason: 'Trying to resurrect the old version.' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('INVALID_STATE');

    // The aggregate stayed SUBMITTED (v2), both versions retained, no new reopen
    // audit event beyond the one legitimate reopen.
    const id = docKey(teamId, v1.sprintId, checkpointId);
    const stored = await repository.getDraft(id);
    expect(stored?.state).toBe('SUBMITTED');
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(2);
    const audit = await repository.listAuditForAggregate(id);
    expect(audit.filter((e) => e.action === 'REOPENED')).toHaveLength(1);
  });

  it('rejects an unauthorised caller (not a Team Lead) with 403 and changes nothing', async () => {
    const teamId = 'grmb';
    const checkpointId = 'C14-1';
    const { version } = await submitVersion(teamId, checkpointId);

    const response = await unauthorisedApp.inject({
      method: 'POST',
      url: `/api/v1/updates/${version.id}/reopen`,
      payload: { reason: 'Contributor tries to reopen.' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PERMISSION_DENIED');

    // The submitted update was NOT reopened: still SUBMITTED with no reopen audit.
    const id = docKey(teamId, version.sprintId, checkpointId);
    const stored = await repository.getDraft(id);
    expect(stored?.state).toBe('SUBMITTED');
    const audit = await repository.listAudit(id);
    expect(audit.some((event) => event.action === 'REOPENED')).toBe(false);
  });
});
