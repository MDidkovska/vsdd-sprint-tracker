/**
 * API-level integration tests for the conflict / rollback theme (task 7.11).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService},
 * {@link SubmitService} and {@link ReopenService} and the Fastify server, then
 * drive the whole slice end-to-end through `app.inject()` — no mocked services.
 * They deliberately target behaviour that the per-endpoint suites do not fully
 * exercise:
 *
 *  1. Optimistic-concurrency CONFLICT — two writers editing the same draft. A
 *     stale `revision`/ETag on `PUT .../drafts/{checkpointId}` returns 409
 *     DRAFT_REVISION_CONFLICT, overwrites neither version, keeps the server-side
 *     revision consistent, and the losing writer can RETRY against the fresh
 *     revision and succeed (R11.5 + the "a failed save must leave the user's
 *     unsaved content available for retry" non-functional requirement).
 *
 *  2. ROLLBACK / atomicity — a failure injected PARTWAY through the atomic
 *     submit-plus-audit path (an immutable version-id collision surfaced inside
 *     the transaction) must roll the WHOLE unit back: the draft is not
 *     transitioned, no immutable version is left for the team+checkpoint and no
 *     audit event is orphaned. The draft stays editable so its content survives
 *     for a retry (R11.2, R14.1/R14.2/R14.4 + the atomicity NFR).
 *
 *  3. IMMUTABILITY / append-only — a full reopen + edit + resubmit lifecycle
 *     retains BOTH immutable versions with the first version byte-for-byte
 *     unchanged, and the audit trail is append-only across the lifecycle
 *     (R11.3, R11.4, R14.1, R14.2).
 *
 * Because the submit and reopen paths are transactional, the suite runs against
 * an in-process MongoDB REPLICA SET (`MongoMemoryReplSet`) — standalone MongoDB
 * cannot run multi-document transactions. A docker-compose replica set can be
 * used instead via `MONGO_TEST_URI`.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mockAuthContext } from '../auth/mockAuth.js';
import {
  CURRENT_SCHEMA_VERSION,
  docKey,
  type UpdateDocument,
  type UpdateVersion,
} from '../domain/documents.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { ReopenService } from './reopenService.js';
import { SubmitService } from './submitService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_conflict_rollback_test';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    // A single-member replica set is enough to enable transactions locally.
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
    leadershipAsk: 'None',
    ...overrides,
  };
}

/** Create a draft at revision 1 for a team+checkpoint and return the document. */
async function createDraft(
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest> = {},
): Promise<UpdateDocument> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ revision: 0, ...overrides }),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as UpdateDocument;
}

describe('API integration — optimistic-concurrency conflicts (R11.5)', () => {
  it('rejects the stale writer with 409 and overwrites neither version', async () => {
    const teamId = 'mmm-a';
    const checkpointId = 'C14-1';
    // Both writers open the draft at revision 1.
    const opened = await createDraft(teamId, checkpointId, { achievements: 'original content' });
    expect(opened.revision).toBe(1);

    // Writer A saves first: revision 1 -> 2.
    const writerA = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: 1, achievements: 'writer A content' }),
    });
    expect(writerA.statusCode).toBe(200);
    expect((writerA.json() as UpdateDocument).revision).toBe(2);

    // Writer B still believes the revision is 1 -> stale write must conflict.
    const writerB = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: 1, achievements: 'writer B content' }),
    });
    expect(writerB.statusCode).toBe(409);
    const body = writerB.json();
    expect(body).toMatchObject({
      error: { code: 'DRAFT_REVISION_CONFLICT', fieldErrors: [] },
      server: { revision: 2, updatedBy: 'user-md' },
    });
    expect(body.error.correlationId).toBeTruthy();
    expect(typeof body.server.updatedAt).toBe('string');

    // No silent last-write-wins: writer A's content survives, revision is stable.
    const current = await repository.getDraft(docKey(teamId, 'S14', checkpointId));
    expect(current?.revision).toBe(2);
    expect(current?.payload.achievements).toBe('writer A content');
    expect(current?.updatedBy).toBe('user-md');
  });

  it('lets the losing writer retry against the fresh revision and succeed', async () => {
    const teamId = 'mmm-b';
    const checkpointId = 'C14-1';
    await createDraft(teamId, checkpointId, { achievements: 'original content' });

    // Writer A advances 1 -> 2.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: 1, achievements: 'writer A content' }),
    });

    // Writer B's first attempt is stale and rejected — its content is NOT lost,
    // it is simply not persisted yet.
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: 1, achievements: 'writer B content' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().server.revision).toBe(2);

    // Writer B reconciles against the server revision (2) and retries the same
    // content — the retry succeeds and is persisted (revision 2 -> 3).
    const retry = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: 2, achievements: 'writer B content' }),
    });
    expect(retry.statusCode).toBe(200);
    const retried = retry.json() as UpdateDocument;
    expect(retried.revision).toBe(3);
    expect(retried.payload.achievements).toBe('writer B content');

    const current = await repository.getDraft(docKey(teamId, 'S14', checkpointId));
    expect(current?.revision).toBe(3);
    expect(current?.payload.achievements).toBe('writer B content');
  });
});

describe('API integration — atomic submit rollback (R11.2, R14)', () => {
  it('rolls the whole submit-plus-audit unit back when a version append fails partway', async () => {
    const teamId = 'o24-app';
    const checkpointId = 'C14-1';
    const draft = await createDraft(teamId, checkpointId, { achievements: 'content to preserve' });
    expect(draft.state).toBe('DRAFT');
    expect(draft.revision).toBe(1);

    // Inject a fault PARTWAY through the atomic submit: pre-create an immutable
    // version whose id COLLIDES with the id the submit will generate
    // (`${teamId}-S14-${checkpointId}-v1`). It is keyed to a decoy team/checkpoint
    // so the submit service still computes versionNumber 1 (its `listVersions`
    // query for this team+checkpoint returns nothing) — yet the version insert
    // inside the transaction hits the unique-id guard and aborts. This mirrors a
    // concurrent submit racing to the same immutable id (design.md §4a).
    const collidingVersionId = `${teamId}-S14-${checkpointId}-v1`;
    const decoy: UpdateVersion = {
      id: collidingVersionId,
      programmeId: 'decoy',
      streamId: 'DECOY',
      teamId: 'zzz-decoy-team',
      sprintId: 'S99',
      checkpointId: 'ZZZ-DECOY',
      versionNumber: 1,
      submittedBy: 'decoy',
      submittedAt: new Date().toISOString(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: draft.payload,
    };
    await repository.appendVersion(decoy);

    // The submit must fail — the transaction aborts on the duplicate version id.
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: draft.revision, achievements: 'content to preserve' }),
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: 'SAVE_FAILED' } });

    // Rollback: the draft transition was undone — still an editable DRAFT at the
    // same revision, with its content intact (nothing partially committed).
    const stored = await repository.getDraft(docKey(teamId, 'S14', checkpointId));
    expect(stored?.state).toBe('DRAFT');
    expect(stored?.revision).toBe(1);
    expect(stored?.payload.achievements).toBe('content to preserve');

    // No orphaned immutable version was persisted for this team+checkpoint.
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(0);

    // No orphaned audit event was left behind for the (would-be) version entity.
    const audit = await repository.listAudit(collidingVersionId);
    expect(audit).toHaveLength(0);
  });

  it('leaves the draft editable after a failed submit so its content is available for retry', async () => {
    const teamId = 'oah-sales';
    const checkpointId = 'C14-1';
    const draft = await createDraft(teamId, checkpointId, { achievements: 'unsaved work' });

    // Force the same mid-transaction failure as above.
    const collidingVersionId = `${teamId}-S14-${checkpointId}-v1`;
    await repository.appendVersion({
      id: collidingVersionId,
      programmeId: 'decoy',
      streamId: 'DECOY',
      teamId: 'zzz-decoy-team-2',
      sprintId: 'S99',
      checkpointId: 'ZZZ-DECOY',
      versionNumber: 1,
      submittedBy: 'decoy',
      submittedAt: new Date().toISOString(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: draft.payload,
    });

    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: draft.revision, achievements: 'unsaved work' }),
    });
    expect(failed.statusCode).toBe(500);

    // The user can still edit and save their draft (content is not lost).
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: draft.revision, achievements: 'edited after failed submit' }),
    });
    expect(edit.statusCode).toBe(200);
    const edited = edit.json() as UpdateDocument;
    expect(edited.state).toBe('DRAFT');
    expect(edited.revision).toBe(2);
    expect(edited.payload.achievements).toBe('edited after failed submit');
  });
});

describe('API integration — immutability across reopen + resubmit (R11.3, R11.4, R14)', () => {
  it('retains both immutable versions with the first unchanged and an append-only audit trail', async () => {
    const teamId = 'grmb';
    const checkpointId = 'C14-1';
    const draft = await createDraft(teamId, checkpointId, { achievements: 'v1 achievements' });

    // Submit v1.
    const submitV1 = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: draft.revision, achievements: 'v1 achievements' }),
    });
    expect(submitV1.statusCode).toBe(200);
    const { document: submittedDoc, version: v1 } = submitV1.json() as {
      document: UpdateDocument;
      version: UpdateVersion;
    };
    expect(v1.versionNumber).toBe(1);

    // The submission created its immutable version + audit event atomically.
    const v1Audit = await repository.listAudit(v1.id);
    expect(v1Audit.filter((e) => e.action === 'SUBMITTED')).toHaveLength(1);

    // Reopen — the prior submitted version must NOT be mutated.
    const reopen = await app.inject({
      method: 'POST',
      url: `/api/v1/updates/${v1.id}/reopen`,
      payload: { reason: 'Correcting the executed count after a re-run.' },
    });
    expect(reopen.statusCode).toBe(200);
    const reopened = reopen.json() as UpdateDocument;
    expect(reopened.state).toBe('REOPENED');
    expect(reopened.revision).toBe(submittedDoc.revision + 1);

    // v1 is byte-for-byte immutable after the reopen.
    expect(await repository.getVersion(v1.id)).toEqual(v1);

    // Edit the reopened draft and resubmit -> a second immutable version.
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: reopened.revision, achievements: 'v2 achievements' }),
    });
    expect(edit.statusCode).toBe(200);
    const edited = edit.json() as UpdateDocument;
    expect(edited.state).toBe('REOPENED');

    const submitV2 = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: edited.revision, achievements: 'v2 achievements' }),
    });
    expect(submitV2.statusCode).toBe(200);
    const { version: v2 } = submitV2.json() as { version: UpdateVersion };
    expect(v2.versionNumber).toBe(2);

    // Both versions are retained; the first is unchanged, the second is new.
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(await repository.getVersion(v1.id)).toEqual(v1);
    expect(v1.payload.achievements).toBe('v1 achievements');
    expect(v2.payload.achievements).toBe('v2 achievements');

    // The audit trail is append-only across the lifecycle: the original v1
    // SUBMITTED event is retained unchanged, the reopen is recorded against the
    // aggregate, and v2 has its own SUBMITTED event.
    const id = docKey(teamId, 'S14', checkpointId);
    expect(await repository.listAudit(v1.id)).toEqual(v1Audit);
    const aggregateAudit = await repository.listAudit(id);
    expect(aggregateAudit.some((e) => e.action === 'REOPENED')).toBe(true);
    const v2Audit = await repository.listAudit(v2.id);
    expect(v2Audit.filter((e) => e.action === 'SUBMITTED')).toHaveLength(1);
  });
});
