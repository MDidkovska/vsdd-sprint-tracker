/**
 * Mongo integration test for in-app notifications (task 9.1).
 *
 * Wires the REAL {@link MongoDocumentRepository} to the real
 * {@link NotificationService} with a fixed clock and a Contributor principal,
 * then proves the three persistence guarantees against MongoDB:
 *  - PERSISTENCE: a generated reminder is stored and readable from a freshly
 *    reconnected repository;
 *  - DEDUPLICATION: reloading the inbox never creates a duplicate (the stable
 *    notification key + unique index make generation idempotent);
 *  - READ STATE: marking a notification read persists the `readAt` and clears
 *    the unread count.
 *
 * Runs against an in-process MongoDB replica set (`MongoMemoryReplSet`) to match
 * the other Mongo integration suites; `MONGO_TEST_URI` can point at a real one.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import {
  CURRENT_SCHEMA_VERSION,
  docKey,
  type AuditEvent,
  type RagValue,
  type UpdateDocument,
  type UpdatePayload,
  type UpdateVersion,
} from '../domain/documents.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { NotificationService } from './notificationService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let uri: string;
const dbName = 'vsdd_poc_notification_test';

// A fixed instant 6 hours before the C14-1 deadline (2026-08-28T16:00Z) so the
// current checkpoint is DUE_SOON. No update document is seeded, so the update
// is MISSING — a valid deadline-reminder target.
const CLOCK = () => new Date('2026-08-28T10:00:00Z');

/** A Contributor assigned to mmm-a within the vsdd programme. */
const contributor: CurrentUser = {
  subject: 'user-contrib',
  email: 'contrib@vsdd.test',
  displayName: 'Cara Contributor',
  initials: 'CC',
  roleLabel: 'Team Contributor',
  status: 'ACTIVE',
  programmeId: 'vsdd',
  roles: ['CONTRIBUTOR'],
  assignedTeamIds: ['mmm-a'],
  canViewAll: false,
};

const auth: AuthContext = { getCurrentUser: () => contributor };

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
  await repository.seedReferenceData(buildReferenceData());
}, 120_000);

afterAll(async () => {
  await repository?.close();
  await replSet?.stop();
});

describe('notification persistence (task 9.1)', () => {
  it('persists a generated reminder, deduplicates on reload and records read state', async () => {
    const service = new NotificationService(repository, auth, CLOCK);

    // First inbox load generates + persists exactly one DUE_SOON reminder for
    // the Missing current-checkpoint update.
    const first = await service.getInbox();
    expect(first.items).toHaveLength(1);
    expect(first.unreadCount).toBe(1);
    const reminder = first.items[0]!;
    expect(reminder.type).toBe('DUE_SOON');
    expect(reminder.teamId).toBe('mmm-a');
    expect(reminder.checkpointId).toBe('C14-1');

    // DEDUPLICATION: a second load creates nothing new.
    const second = await service.getInbox();
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).toBe(reminder.id);

    // PERSISTENCE: a freshly reconnected repository still sees the stored row.
    const reconnected = await MongoDocumentRepository.connect({ uri, dbName });
    try {
      const stored = await reconnected.listNotificationsForRecipient('user-contrib');
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe(reminder.id);
      expect(stored[0]?.readAt).toBeUndefined();
    } finally {
      await reconnected.close();
    }

    // READ STATE: marking it read persists readAt and clears the unread count.
    const updated = await service.markRead(reminder.id);
    expect(updated.readAt).toBeDefined();

    const afterRead = await service.getInbox();
    expect(afterRead.items).toHaveLength(1);
    expect(afterRead.unreadCount).toBe(0);

    const persistedRead = await repository.getNotification(reminder.id);
    expect(persistedRead?.readAt).toBeDefined();
  });
});

// --- status alerts (task 9.2) ---------------------------------------------

/** An ACTIVE Leadership principal assigned to the vsdd programme. */
const leadership: CurrentUser = {
  subject: 'user-lead',
  email: 'lead@vsdd.test',
  displayName: 'Leo Leader',
  initials: 'LL',
  roleLabel: 'Programme Leadership',
  status: 'ACTIVE',
  programmeId: 'vsdd',
  roles: ['LEADERSHIP'],
  assignedTeamIds: [],
  canViewAll: true,
};
const leadershipAuth: AuthContext = { getCurrentUser: () => leadership };

function minimalPayload(): UpdatePayload {
  return {
    goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
    qualityEvidence: { planned: 10, executed: 5, passed: 5, openCritical: 0, blocked: 0, automationPercent: 0 },
    achievements: 'a',
    aiValue: { useCase: 'u', measurableBenefit: 'm', humanValidation: 'h', nextExperimentConstraint: 'c' },
    exceptions: [],
    leadershipAsk: 'None',
    statusRationale: '',
    metricsNote: '',
  };
}

/** Submit one immutable version for a team at the current checkpoint C14-1 with
 *  the chosen alert conditions, and return the version id. */
async function submitVersionFor(
  teamId: string,
  opts: { release?: RagValue; hasBlocker?: boolean; hasLeadershipAsk?: boolean } = {},
): Promise<string> {
  const sprintId = 'S14';
  const checkpointId = 'C14-1';
  const id = docKey(teamId, sprintId, checkpointId);
  const now = '2026-08-27T09:00:00Z';
  const rag = { business: 'GREEN' as RagValue, delivery: 'GREEN' as RagValue, release: opts.release ?? 'GREEN' };
  const hasBlocker = opts.hasBlocker ?? false;
  const hasLeadershipAsk = opts.hasLeadershipAsk ?? false;
  const payload = minimalPayload();

  const document: Omit<UpdateDocument, 'revision'> = {
    id,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId,
    checkpointId,
    state: 'SUBMITTED',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag,
    hasBlocker,
    hasLeadershipAsk,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'seed',
    submittedAt: now,
    payload,
  };
  const version: UpdateVersion = {
    id: `${teamId}-${sprintId}-${checkpointId}-v1`,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId,
    checkpointId,
    versionNumber: 1,
    submittedBy: 'seed',
    submittedAt: now,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rag,
    hasBlocker,
    hasLeadershipAsk,
    payload,
  };
  const audit: AuditEvent = {
    id: `audit-${teamId}-submit`,
    programmeId: 'vsdd',
    aggregateId: id,
    entityType: 'VERSION',
    entityId: version.id,
    action: 'SUBMITTED',
    actorSubject: 'seed',
    timestamp: now,
    previousVersion: 0,
    newVersion: 1,
    correlationId: `corr-${teamId}`,
  };

  const outcome = await repository.submitUpdate({ document, version, audit, expectedRevision: 0 });
  expect(outcome.ok).toBe(true);
  return version.id;
}

describe('status-alert persistence (task 9.2)', () => {
  it('persists RED + blocker + ask alerts, dedups, deep-links to the version and records read state', async () => {
    // Submit a version that triggers all three conditions for a distinct team.
    const versionId = await submitVersionFor('mmm-b', {
      release: 'RED',
      hasBlocker: true,
      hasLeadershipAsk: true,
    });

    const service = new NotificationService(repository, leadershipAuth, CLOCK);

    // First load generates the three status alerts for the leader.
    const first = await service.getInbox();
    const alerts = first.items.filter((n) => n.teamId === 'mmm-b');
    expect(alerts.map((n) => n.type).sort()).toEqual([
      'LEADERSHIP_ASK',
      'OPEN_BLOCKER',
      'RELEASE_RED',
    ]);
    const red = alerts.find((n) => n.type === 'RELEASE_RED')!;
    expect(red.deepLink.view).toBe('leadership');
    expect(red.deepLink.versionId).toBe(versionId);

    // DEDUPLICATION: a second load creates nothing new.
    const second = await service.getInbox();
    expect(second.items.filter((n) => n.teamId === 'mmm-b')).toHaveLength(3);

    // PERSISTENCE: a freshly reconnected repository still sees the stored alerts
    // including the version deep link.
    const reconnected = await MongoDocumentRepository.connect({ uri, dbName });
    try {
      const stored = await reconnected.listNotificationsForRecipient('user-lead');
      const storedAlerts = stored.filter((n) => n.teamId === 'mmm-b');
      expect(storedAlerts).toHaveLength(3);
      expect(storedAlerts.find((n) => n.type === 'RELEASE_RED')?.deepLink.versionId).toBe(
        versionId,
      );
    } finally {
      await reconnected.close();
    }

    // READ STATE: marking one read persists readAt.
    await service.markRead(red.id);
    const persistedRead = await repository.getNotification(red.id);
    expect(persistedRead?.readAt).toBeDefined();
  });

  it('keys alerts by version: V1 persists + dedups on reload, and a newer V2 raises a separate alert linking to V2', async () => {
    const teamId = 'mmm-a';
    // (1) V1 submitted with Red release confidence creates + persists one alert.
    const v1Id = await submitVersionFor(teamId, { release: 'RED' });
    const service = new NotificationService(repository, leadershipAuth, CLOCK);

    const first = (await service.getInbox()).items.filter((n) => n.teamId === teamId);
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe('RELEASE_RED');
    expect(first[0]?.deepLink.versionId).toBe(v1Id);

    // (2) A repeated load does not duplicate the V1 alert.
    expect((await service.getInbox()).items.filter((n) => n.teamId === teamId)).toHaveLength(1);

    // Persisted through a freshly reconnected repository.
    const reconnected = await MongoDocumentRepository.connect({ uri, dbName });
    try {
      const stored = (await reconnected.listNotificationsForRecipient('user-lead')).filter(
        (n) => n.teamId === teamId,
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.deepLink.versionId).toBe(v1Id);
    } finally {
      await reconnected.close();
    }

    // (3) A newer submitted version V2 with the SAME Red condition.
    const v2: UpdateVersion = {
      id: `${teamId}-S14-C14-1-v2`,
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId,
      sprintId: 'S14',
      checkpointId: 'C14-1',
      versionNumber: 2,
      submittedBy: 'seed',
      submittedAt: '2026-08-27T12:00:00Z',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'RED' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: minimalPayload(),
    };
    await repository.appendVersion(v2);

    const afterV2 = (await service.getInbox()).items.filter(
      (n) => n.teamId === teamId && n.type === 'RELEASE_RED',
    );
    expect(afterV2).toHaveLength(2);

    // (4) The new alert deep-links to V2 and is still unread.
    const v2Alert = afterV2.find((n) => n.deepLink.versionId === v2.id);
    expect(v2Alert).toBeDefined();
    expect(v2Alert?.readAt).toBeUndefined();
  });
});
