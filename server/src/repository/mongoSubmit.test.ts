/**
 * Adapter-level atomicity tests for `submitUpdate` (task 7.5).
 *
 * These exercise the REAL MongoDB adapter's transactional submit against an
 * in-process MongoDB REPLICA SET (`MongoMemoryReplSet`) — multi-document
 * transactions require a replica set / mongos. They prove the three writes
 * (draft transition, immutable version append, audit append) are ONE atomic
 * unit:
 *  - the happy path commits all three;
 *  - a stale revision creates nothing and reports the current server envelope;
 *  - a mid-transaction failure (a duplicate immutable version id) rolls the
 *    WHOLE unit back — the draft is not transitioned and no audit is appended
 *    (design.md §4a atomicity guarantee, R14.1/R14.4).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  docKey,
  type AuditEvent,
  type UpdateDocument,
  type UpdatePayload,
  type UpdateVersion,
} from '../domain/documents.js';
import { ImmutableViolationError } from './errors.js';
import { MongoDocumentRepository } from './mongoDocumentRepository.js';
import type { SubmitDraftInput } from './documentRepository.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let uri: string;
const dbName = 'vsdd_poc_submit_adapter_test';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
}, 120_000);

afterAll(async () => {
  await repository?.close();
  await replSet?.stop();
});

function samplePayload(overrides: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: {
      business: 'Enable the September release journey.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests and raise evidence.',
      nextWeekCommitment: 'Complete blocked tests and confirm readiness.',
    },
    qualityEvidence: { planned: 120, executed: 84, passed: 79, openCritical: 1, blocked: 5, automationPercent: 18 },
    achievements: 'Execution reached 70% of plan.',
    aiValue: {
      useCase: 'AI-assisted test case generation',
      measurableBenefit: '27% reduction in design effort',
      humanValidation: 'Test lead review against requirements',
      nextExperimentConstraint: 'Extend to regression with human approval',
    },
    exceptions: [],
    leadershipAsk: 'None',
    statusRationale: '',
    metricsNote: '',
    ...overrides,
  };
}

function submitInputFor(
  teamId: string,
  expectedRevision: number,
  versionNumber: number,
  auditId: string,
): SubmitDraftInput {
  const sprintId = 'S14';
  const checkpointId = 'C14-1';
  const id = docKey(teamId, sprintId, checkpointId);
  const payload = samplePayload();
  const now = new Date().toISOString();

  const document: Omit<UpdateDocument, 'revision'> = {
    id,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId,
    checkpointId,
    state: 'SUBMITTED',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'user-md',
    submittedAt: now,
    payload,
  };
  const version: UpdateVersion = {
    id: `${teamId}-${sprintId}-${checkpointId}-v${versionNumber}`,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId,
    checkpointId,
    versionNumber,
    submittedBy: 'user-md',
    submittedAt: now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload,
  };
  const audit: AuditEvent = {
    id: auditId,
    programmeId: 'vsdd',
    aggregateId: id,
    entityType: 'VERSION',
    entityId: version.id,
    action: 'SUBMITTED',
    actorSubject: 'user-md',
    timestamp: now,
    previousVersion: expectedRevision,
    newVersion: expectedRevision + 1,
    correlationId: 'corr-submit',
  };
  return { document, version, audit, expectedRevision };
}

describe('MongoDocumentRepository.submitUpdate', () => {
  it('commits the draft transition, version and audit as one atomic unit', async () => {
    const teamId = 'atomic-ok';
    const input = submitInputFor(teamId, 0, 1, 'audit-atomic-ok');

    const outcome = await repository.submitUpdate(input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.document.state).toBe('SUBMITTED');
    expect(outcome.document.revision).toBe(1);

    const stored = await repository.getDraft(input.document.id);
    expect(stored?.state).toBe('SUBMITTED');
    expect(await repository.getVersion(input.version.id)).not.toBeNull();
    const audit = await repository.listAudit(input.version.id);
    expect(audit).toHaveLength(1);
  });

  it('creates nothing on a stale revision and reports the server envelope', async () => {
    const teamId = 'atomic-conflict';
    // Seed a draft at revision 1 via a first submit-from-scratch.
    const first = await repository.submitUpdate(submitInputFor(teamId, 0, 1, 'audit-conflict-1'));
    expect(first.ok).toBe(true);

    // A submit that still believes the revision is 0 is stale (stored is 1).
    const stale = await repository.submitUpdate(submitInputFor(teamId, 0, 2, 'audit-conflict-2'));
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.conflict).toBe(true);
    expect(stale.server.revision).toBe(1);

    // Nothing extra was created: still exactly one version and one audit event.
    const versions = await repository.listVersions(teamId, 'C14-1');
    expect(versions).toHaveLength(1);
    const audit = await repository.listAudit(`${teamId}-S14-C14-1-v2`);
    expect(audit).toHaveLength(0);
  });

  it('rolls the whole unit back when the immutable version id already exists', async () => {
    const teamId = 'atomic-rollback';
    // Pre-create a draft at revision 1 (editable) so the submit will transition it.
    const draftDoc = submitInputFor(teamId, 0, 99, 'unused').document;
    const created = await repository.saveDraft({
      document: { ...draftDoc, state: 'DRAFT' },
      expectedRevision: 0,
    });
    expect(created.ok).toBe(true);

    // Pre-insert a version with the SAME id the submit will try to append.
    const clashing = submitInputFor(teamId, 1, 1, 'audit-rollback-first');
    await repository.appendVersion(clashing.version);

    // The submit tries to append a duplicate version id -> the transaction must
    // abort and roll back EVERYTHING.
    await expect(
      repository.submitUpdate(submitInputFor(teamId, 1, 1, 'audit-rollback-second')),
    ).rejects.toBeInstanceOf(ImmutableViolationError);

    // The draft was NOT transitioned to SUBMITTED (rollback).
    const stored = await repository.getDraft(docKey(teamId, 'S14', 'C14-1'));
    expect(stored?.state).toBe('DRAFT');
    expect(stored?.revision).toBe(1);

    // The second audit event was NOT appended (rollback).
    const audit = await repository.listAudit(`${teamId}-S14-C14-1-v1`);
    expect(audit.some((event) => event.id === 'audit-rollback-second')).toBe(false);
  });
});
