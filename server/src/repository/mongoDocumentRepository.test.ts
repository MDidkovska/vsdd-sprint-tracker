/**
 * Persistence integration tests for the MongoDB document adapter.
 *
 * These exercise the REAL adapter against a real MongoDB. When Docker is
 * available you can point them at the docker-compose instance via
 * `MONGO_TEST_URI`; otherwise they fall back to an ephemeral in-process MongoDB
 * (`mongodb-memory-server`) so the suite is always runnable (design.md §4b PoC).
 *
 * Covered:
 *  - connect + readiness ping
 *  - write a draft document and read it back
 *  - optimistic-concurrency revision guard: a stale revision returns a conflict
 *    and overwrites nothing (R11.5)
 *  - append-only immutability for submitted versions and audit events (R14)
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  deriveEnvelopeFlags,
  docKey,
  type AuditEvent,
  type UpdateDocument,
  type UpdatePayload,
  type UpdateVersion,
} from '../domain/documents.js';
import { ImmutableViolationError } from './errors.js';
import { MongoDocumentRepository } from './mongoDocumentRepository.js';

let memoryServer: MongoMemoryServer | undefined;
let repository: MongoDocumentRepository;
let uri: string;
const dbName = 'vsdd_poc_test';

beforeAll(async () => {
  // Prefer an externally provided Mongo (e.g. docker-compose) when present.
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
});

afterAll(async () => {
  await repository?.close();
  await memoryServer?.stop();
});

// Each test uses a distinct team/aggregate id, so no per-test cleanup is needed.

function samplePayload(overrides: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: {
      business: 'Enable the September release journey.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests and raise evidence.',
      nextWeekCommitment: 'Complete blocked tests and confirm readiness.',
    },
    qualityEvidence: {
      planned: 120,
      executed: 84,
      passed: 79,
      openCritical: 1,
      blocked: 5,
      automationPercent: 18,
    },
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

function makeDraft(
  overrides: Partial<UpdateDocument> = {},
  payload: UpdatePayload = samplePayload(),
): Omit<UpdateDocument, 'revision'> {
  const teamId = overrides.teamId ?? 'mmm-a';
  const sprintId = overrides.sprintId ?? 'S14';
  const checkpointId = overrides.checkpointId ?? 'C14-1';
  const flags = deriveEnvelopeFlags(payload);
  const now = new Date().toISOString();
  return {
    id: docKey(teamId, sprintId, checkpointId),
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId,
    checkpointId,
    state: 'DRAFT',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    hasBlocker: flags.hasBlocker,
    hasLeadershipAsk: flags.hasLeadershipAsk,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'user-md',
    payload,
    ...overrides,
  };
}

describe('MongoDocumentRepository', () => {
  it('connects and answers a readiness ping', async () => {
    await expect(repository.ping()).resolves.toBe(true);
  });

  it('writes a draft document and reads it back', async () => {
    const draft = makeDraft({ teamId: 'read-back' });
    const outcome = await repository.saveDraft({ document: draft, expectedRevision: 0 });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return; // narrow for the type checker

    expect(outcome.document.revision).toBe(1);
    expect(outcome.document.id).toBe(draft.id);

    const stored = await repository.getDraft(draft.id);
    expect(stored).not.toBeNull();
    expect(stored?.revision).toBe(1);
    expect(stored?.payload.goals.business).toBe(draft.payload.goals.business);
    // The physical Mongo _id must never leak into the domain shape.
    expect((stored as unknown as { _id?: unknown })._id).toBeUndefined();
  });

  it('increments revision across successive saves', async () => {
    const draft = makeDraft({ teamId: 'rev-inc' });
    const first = await repository.saveDraft({ document: draft, expectedRevision: 0 });
    expect(first.ok).toBe(true);

    const second = await repository.saveDraft({ document: draft, expectedRevision: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.document.revision).toBe(2);
  });

  it('rejects a stale revision with a conflict and overwrites nothing', async () => {
    const draft = makeDraft(
      { teamId: 'conflict', updatedBy: 'first-writer' },
      samplePayload({ achievements: 'original content' }),
    );
    const created = await repository.saveDraft({ document: draft, expectedRevision: 0 });
    expect(created.ok).toBe(true);

    // A second writer advances the revision to 2.
    const advanced = await repository.saveDraft({
      document: makeDraft(
        { teamId: 'conflict', updatedBy: 'second-writer' },
        samplePayload({ achievements: 'second-writer content' }),
      ),
      expectedRevision: 1,
    });
    expect(advanced.ok).toBe(true);

    // The first writer still holds revision 1 -> must be rejected as a conflict.
    const stale = await repository.saveDraft({
      document: makeDraft(
        { teamId: 'conflict', updatedBy: 'first-writer' },
        samplePayload({ achievements: 'stale overwrite attempt' }),
      ),
      expectedRevision: 1,
    });

    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.conflict).toBe(true);
    expect(stale.server.revision).toBe(2);

    // Nothing was overwritten: the second writer's content survives.
    const stored = await repository.getDraft(draft.id);
    expect(stored?.revision).toBe(2);
    expect(stored?.payload.achievements).toBe('second-writer content');
    expect(stored?.updatedBy).toBe('second-writer');
  });

  it('treats a concurrent create (id already exists) as a conflict', async () => {
    const draft = makeDraft({ teamId: 'dup-create' });
    const first = await repository.saveDraft({ document: draft, expectedRevision: 0 });
    expect(first.ok).toBe(true);

    const concurrent = await repository.saveDraft({ document: draft, expectedRevision: 0 });
    expect(concurrent.ok).toBe(false);
    if (concurrent.ok) return;
    expect(concurrent.conflict).toBe(true);
  });

  it('stores an immutable submitted version and rejects a duplicate', async () => {
    const payload = samplePayload();
    const flags = deriveEnvelopeFlags(payload);
    const version: UpdateVersion = {
      id: 'immutable-team-S14-C14-1-v1',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'immutable-team',
      sprintId: 'S14',
      checkpointId: 'C14-1',
      versionNumber: 1,
      submittedBy: 'user-md',
      submittedAt: new Date().toISOString(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      payload,
    };

    await expect(repository.appendVersion(version)).resolves.toMatchObject({ id: version.id });

    const stored = await repository.getVersion(version.id);
    expect(stored?.versionNumber).toBe(1);

    // Re-appending the same version id must be rejected — versions are immutable.
    await expect(repository.appendVersion(version)).rejects.toBeInstanceOf(
      ImmutableViolationError,
    );
  });

  it('lists submitted versions newest-first for a team + checkpoint', async () => {
    const base = {
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'history-team',
      sprintId: 'S14',
      checkpointId: 'C14-1',
      submittedBy: 'user-md',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: samplePayload(),
    } as const;

    await repository.appendVersion({
      ...base,
      id: 'history-team-S14-C14-1-v1',
      versionNumber: 1,
      submittedAt: '2026-08-25T09:00:00Z',
    });
    await repository.appendVersion({
      ...base,
      id: 'history-team-S14-C14-1-v2',
      versionNumber: 2,
      submittedAt: '2026-08-26T09:00:00Z',
    });

    const versions = await repository.listVersions('history-team', 'C14-1');
    expect(versions.map((v) => v.versionNumber)).toEqual([2, 1]);
  });

  it('appends audit events and rejects duplicates (append-only)', async () => {
    const event: AuditEvent = {
      id: 'audit-1',
      programmeId: 'vsdd',
      entityType: 'UPDATE',
      entityId: docKey('audit-team', 'S14', 'C14-1'),
      action: 'DRAFT_SAVED',
      actorSubject: 'user-md',
      timestamp: new Date().toISOString(),
      previousVersion: 0,
      newVersion: 1,
      correlationId: 'corr-1',
    };

    await expect(repository.appendAudit(event)).resolves.toMatchObject({ id: 'audit-1' });

    const trail = await repository.listAudit(event.entityId);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.action).toBe('DRAFT_SAVED');

    await expect(repository.appendAudit(event)).rejects.toBeInstanceOf(
      ImmutableViolationError,
    );
  });
});
