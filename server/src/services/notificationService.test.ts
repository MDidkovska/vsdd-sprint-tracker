/**
 * Focused unit tests for the in-app notification service (task 9.1).
 *
 * These wire the {@link NotificationService} to a small in-memory fake of its
 * repository port and a fixed clock, so every deadline scenario is exercised
 * deterministically without MongoDB. Covered:
 *  - DUE_SOON (deadline within 24h) and OVERDUE (deadline passed) generation
 *    for Draft/Missing updates;
 *  - submitted (and reopened) updates suppress reminders (stop after submission);
 *  - no reminder before the window opens, when > 24h away, or once closed;
 *  - idempotent/deduplicated generation across repeated inbox loads;
 *  - read state (mark one / mark all) and the unread count;
 *  - recipient isolation (a user never sees or marks another user's items);
 *  - only ACTIVE Contributors/Team Leads receive reminders;
 *  - every reminder carries a task-9.3 deep link to the exact context.
 */
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type {
  RagValue,
  UpdateDocument,
  UpdateState,
  UpdateVersion,
} from '../domain/documents.js';
import { docKey } from '../domain/documents.js';
import type { ReportingCheckpoint, Sprint, Team } from '../domain/hierarchy.js';
import type { Notification } from '../domain/notifications.js';
import type { CurrentUser, Role } from '../domain/identity.js';
import {
  NotificationService,
  type NotificationRepositoryPort,
} from './notificationService.js';

const NOW = Date.parse('2026-08-28T10:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TEAM: Team = {
  id: 'mmm-a',
  streamId: 'MMM',
  name: 'PTSB-VSDD MMM A',
  sortOrder: 1,
  active: true,
};

const SPRINT: Sprint = {
  id: 'S14',
  programmeId: 'vsdd',
  label: 'Sprint 14',
  startDate: '2026-08-24',
  endDate: '2026-09-04',
  status: 'CURRENT',
};

/** A checkpoint whose deadline is `dueOffsetMs` from NOW, open for a wide window. */
function checkpoint(
  overrides: Partial<ReportingCheckpoint> & { dueOffsetMs: number },
): ReportingCheckpoint {
  const { dueOffsetMs, ...rest } = overrides;
  return {
    id: 'C14-1',
    sprintId: 'S14',
    weekNumber: 1,
    opensAt: new Date(NOW - 2 * DAY).toISOString(),
    dueAt: new Date(NOW + dueOffsetMs).toISOString(),
    closesAt: new Date(NOW + 3 * DAY).toISOString(),
    status: 'CURRENT',
    ...rest,
  };
}

interface FakeConfig {
  checkpoints?: ReportingCheckpoint[];
  /** Map of docKey -> stored update state. Absent -> MISSING. */
  states?: Record<string, UpdateState>;
  /** Teams in the programme (status-alert fan-out). Defaults to the single TEAM. */
  teams?: Team[];
  /** Submitted versions available to `listVersions` (status alerts, task 9.2). */
  versions?: UpdateVersion[];
}

class FakeRepo implements NotificationRepositoryPort {
  readonly notifications = new Map<string, Notification>();
  private readonly checkpoints: ReportingCheckpoint[];
  private readonly states: Record<string, UpdateState>;
  private readonly teams: Team[];
  private readonly versions: UpdateVersion[];

  constructor(config: FakeConfig = {}) {
    this.checkpoints = config.checkpoints ?? [checkpoint({ dueOffsetMs: 12 * HOUR })];
    this.states = config.states ?? {};
    this.teams = config.teams ?? [TEAM];
    this.versions = config.versions ?? [];
  }

  async listSprints(programmeId: string): Promise<Sprint[]> {
    // Programme-scoped: a leader in another programme sees no sprints (isolation).
    return [SPRINT].filter((s) => s.programmeId === programmeId);
  }

  async listCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]> {
    return this.checkpoints.filter((c) => c.sprintId === sprintId);
  }

  async listTeams(programmeId: string): Promise<Team[]> {
    // Teams belong to the vsdd programme in this fake; another programme is empty.
    return programmeId === SPRINT.programmeId ? this.teams : [];
  }

  async getTeam(teamId: string): Promise<Team | null> {
    return this.teams.find((t) => t.id === teamId) ?? null;
  }

  async getDraft(id: string): Promise<UpdateDocument | null> {
    const state = this.states[id];
    if (!state) return null;
    return { id, state } as UpdateDocument;
  }

  async listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]> {
    return this.versions
      .filter((v) => v.teamId === teamId && v.checkpointId === checkpointId)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((v) => ({ ...v }));
  }

  /** Append a newer submitted version (test helper for the version-key case). */
  pushVersion(version: UpdateVersion): void {
    this.versions.push({ ...version });
  }

  async insertNotificationIfAbsent(notification: Notification): Promise<boolean> {
    if (this.notifications.has(notification.id)) return false;
    this.notifications.set(notification.id, { ...notification });
    return true;
  }

  async listNotificationsForRecipient(recipientSubject: string): Promise<Notification[]> {
    return [...this.notifications.values()]
      .filter((n) => n.recipientSubject === recipientSubject)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((n) => ({ ...n }));
  }

  async markNotificationRead(
    id: string,
    recipientSubject: string,
    readAt: string,
  ): Promise<Notification | null> {
    const existing = this.notifications.get(id);
    if (!existing || existing.recipientSubject !== recipientSubject) return null;
    existing.readAt = readAt;
    return { ...existing };
  }

  async markAllNotificationsRead(recipientSubject: string, readAt: string): Promise<number> {
    let updated = 0;
    for (const n of this.notifications.values()) {
      if (n.recipientSubject === recipientSubject && !n.readAt) {
        n.readAt = readAt;
        updated += 1;
      }
    }
    return updated;
  }
}

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    subject: 'user-a',
    email: 'a@vsdd.test',
    displayName: 'Ana Contributor',
    initials: 'AC',
    roleLabel: 'Team Contributor',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles: ['CONTRIBUTOR'] as Role[],
    assignedTeamIds: ['mmm-a'],
    canViewAll: false,
    ...overrides,
  };
}

function authFor(current: CurrentUser): AuthContext {
  return { getCurrentUser: () => current };
}

function serviceFor(repo: FakeRepo, current: CurrentUser): NotificationService {
  return new NotificationService(repo, authFor(current), () => new Date(NOW));
}

describe('NotificationService — deadline reminders (task 9.1)', () => {
  it('generates a DUE_SOON reminder for a Missing update within 24h of the deadline', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const service = serviceFor(repo, user());

    const inbox = await service.getInbox();

    expect(inbox.items).toHaveLength(1);
    expect(inbox.unreadCount).toBe(1);
    const [n] = inbox.items;
    expect(n?.type).toBe('DUE_SOON');
    expect(n?.teamId).toBe('mmm-a');
    expect(n?.readAt).toBeUndefined();
  });

  it('generates an OVERDUE reminder for a Draft update whose deadline has passed', async () => {
    const repo = new FakeRepo({
      checkpoints: [checkpoint({ dueOffsetMs: -2 * HOUR })],
      states: { [docKey('mmm-a', 'S14', 'C14-1')]: 'DRAFT' },
    });
    const service = serviceFor(repo, user());

    const inbox = await service.getInbox();

    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.type).toBe('OVERDUE');
  });

  it('does not remind once the update is submitted (stop after submission)', async () => {
    const repo = new FakeRepo({
      checkpoints: [checkpoint({ dueOffsetMs: -2 * HOUR })],
      states: { [docKey('mmm-a', 'S14', 'C14-1')]: 'SUBMITTED' },
    });
    const service = serviceFor(repo, user());

    const inbox = await service.getInbox();
    expect(inbox.items).toHaveLength(0);
  });

  it('does not remind for a reopened update (already submitted at least once)', async () => {
    const repo = new FakeRepo({
      checkpoints: [checkpoint({ dueOffsetMs: -2 * HOUR })],
      states: { [docKey('mmm-a', 'S14', 'C14-1')]: 'REOPENED' },
    });
    const service = serviceFor(repo, user());
    expect((await service.getInbox()).items).toHaveLength(0);
  });

  it('does not remind before the window opens, more than 24h out, or once closed', async () => {
    // Not open yet.
    const notOpen = new FakeRepo({
      checkpoints: [checkpoint({ dueOffsetMs: 2 * HOUR, opensAt: new Date(NOW + HOUR).toISOString() })],
    });
    expect((await serviceFor(notOpen, user()).getInbox()).items).toHaveLength(0);

    // Deadline more than 24h away.
    const far = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 3 * DAY })] });
    expect((await serviceFor(far, user()).getInbox()).items).toHaveLength(0);

    // Window fully closed.
    const closed = new FakeRepo({
      checkpoints: [checkpoint({ dueOffsetMs: -2 * DAY, closesAt: new Date(NOW - HOUR).toISOString() })],
    });
    expect((await serviceFor(closed, user()).getInbox()).items).toHaveLength(0);
  });

  it('is idempotent: reloading the inbox never duplicates a reminder', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const service = serviceFor(repo, user());

    await service.getInbox();
    await service.getInbox();
    const inbox = await service.getInbox();

    expect(inbox.items).toHaveLength(1);
    expect(repo.notifications.size).toBe(1);
  });

  it('marks a single notification read and updates the unread count', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const service = serviceFor(repo, user());
    const { items } = await service.getInbox();
    const id = items[0]!.id;

    const updated = await service.markRead(id);
    expect(updated.readAt).toBeDefined();

    const after = await service.getInbox();
    expect(after.unreadCount).toBe(0);
    expect(after.items[0]?.readAt).toBeDefined();
  });

  it('marks all notifications read', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const service = serviceFor(repo, user());
    await service.getInbox();

    const result = await service.markAllRead();
    expect(result.updated).toBe(1);
    expect((await service.getInbox()).unreadCount).toBe(0);
  });

  it('isolates recipients: a user cannot see or mark another user\'s notifications', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const alice = serviceFor(repo, user({ subject: 'user-a' }));
    const bob = serviceFor(repo, user({ subject: 'user-b' }));

    const aliceInbox = await alice.getInbox();
    const bobInbox = await bob.getInbox();

    // Each generated their own copy (distinct recipient keys); neither sees the
    // other's.
    expect(aliceInbox.items).toHaveLength(1);
    expect(bobInbox.items).toHaveLength(1);
    expect(aliceInbox.items[0]?.recipientSubject).toBe('user-a');
    expect(bobInbox.items[0]?.recipientSubject).toBe('user-b');

    // Bob cannot mark Alice's notification read — it is reported as NOT_FOUND so
    // the endpoint never reveals another recipient's notification.
    await expect(bob.markRead(aliceInbox.items[0]!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('does not generate reminders for a non-editor (Leadership-only) recipient', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const leader = serviceFor(
      repo,
      user({ subject: 'user-lead', roles: ['LEADERSHIP'], canViewAll: true, assignedTeamIds: [] }),
    );

    const inbox = await leader.getInbox();
    expect(inbox.items).toHaveLength(0);
  });

  it('attaches a task-9.3 deep link to the exact team/sprint/week', async () => {
    const repo = new FakeRepo({ checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })] });
    const inbox = await serviceFor(repo, user()).getInbox();

    expect(inbox.items[0]?.deepLink).toEqual({
      view: 'team',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'mmm-a',
      sprintId: 'S14',
      weekNumber: 1,
    });
  });
});

// --- status alerts (task 9.2) ---------------------------------------------

/** Build a submitted version for TEAM at C14-1 with chosen alert conditions. */
function statusVersion(
  overrides: {
    id?: string;
    teamId?: string;
    checkpointId?: string;
    versionNumber?: number;
    release?: RagValue;
    hasBlocker?: boolean;
    hasLeadershipAsk?: boolean;
  } = {},
): UpdateVersion {
  const teamId = overrides.teamId ?? 'mmm-a';
  const checkpointId = overrides.checkpointId ?? 'C14-1';
  const versionNumber = overrides.versionNumber ?? 1;
  return {
    id: overrides.id ?? `${teamId}-${checkpointId}-v${versionNumber}`,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId: 'S14',
    checkpointId,
    versionNumber,
    submittedBy: 'seed',
    submittedAt: new Date(NOW).toISOString(),
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'GREEN', release: overrides.release ?? 'GREEN' },
    hasBlocker: overrides.hasBlocker ?? false,
    hasLeadershipAsk: overrides.hasLeadershipAsk ?? false,
    payload: {} as UpdateVersion['payload'],
  };
}

/** A repo whose current C14-1 cell for mmm-a is SUBMITTED with given versions. */
function statusRepo(
  versions: UpdateVersion[],
  opts: { state?: UpdateState } = {},
): FakeRepo {
  return new FakeRepo({
    checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })],
    states: { [docKey('mmm-a', 'S14', 'C14-1')]: opts.state ?? 'SUBMITTED' },
    teams: [TEAM],
    versions,
  });
}

/** An ACTIVE Leadership principal assigned to the vsdd programme. */
function leader(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return user({
    subject: 'user-lead',
    roleLabel: 'Programme Leadership',
    roles: ['LEADERSHIP'] as Role[],
    canViewAll: true,
    assignedTeamIds: [],
    ...overrides,
  });
}

describe('NotificationService — status alerts (task 9.2)', () => {
  it('raises RELEASE_RED for a submitted version with Red release confidence', async () => {
    const repo = statusRepo([statusVersion({ release: 'RED' })]);
    const inbox = await serviceFor(repo, leader()).getInbox();

    expect(inbox.items).toHaveLength(1);
    const [n] = inbox.items;
    expect(n?.type).toBe('RELEASE_RED');
    expect(n?.teamId).toBe('mmm-a');
    expect(n?.readAt).toBeUndefined();
  });

  it('raises OPEN_BLOCKER for a submitted version with an unresolved blocker', async () => {
    const repo = statusRepo([statusVersion({ hasBlocker: true })]);
    const inbox = await serviceFor(repo, leader()).getInbox();

    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.type).toBe('OPEN_BLOCKER');
  });

  it('raises LEADERSHIP_ASK for a submitted version with a non-None leadership ask', async () => {
    const repo = statusRepo([statusVersion({ hasLeadershipAsk: true })]);
    const inbox = await serviceFor(repo, leader()).getInbox();

    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.type).toBe('LEADERSHIP_ASK');
  });

  it('raises all three distinct alerts when conditions combine', async () => {
    const repo = statusRepo([
      statusVersion({ release: 'RED', hasBlocker: true, hasLeadershipAsk: true }),
    ]);
    const inbox = await serviceFor(repo, leader()).getInbox();

    expect(inbox.items.map((n) => n.type).sort()).toEqual([
      'LEADERSHIP_ASK',
      'OPEN_BLOCKER',
      'RELEASE_RED',
    ]);
    // Distinct stable keys per type (independent de-duplication).
    expect(new Set(inbox.items.map((n) => n.id)).size).toBe(3);
  });

  it('generates nothing when the version has none of the conditions', async () => {
    const repo = statusRepo([statusVersion({ release: 'AMBER' })]);
    expect((await serviceFor(repo, leader()).getInbox()).items).toHaveLength(0);
  });

  it('sends action alerts to an ACTIVE Admin too', async () => {
    const repo = statusRepo([statusVersion({ hasBlocker: true })]);
    const admin = leader({ subject: 'user-admin', roles: ['ADMIN'] as Role[] });
    expect((await serviceFor(repo, admin).getInbox()).items[0]?.type).toBe('OPEN_BLOCKER');
  });

  it('never sends action alerts to an Auditor (read-only) or an editor', async () => {
    const version = [statusVersion({ release: 'RED', hasBlocker: true, hasLeadershipAsk: true })];

    const auditor = leader({ subject: 'user-aud', roles: ['AUDITOR'] as Role[] });
    expect((await serviceFor(statusRepo(version), auditor).getInbox()).items).toHaveLength(0);

    const contributor = user({ subject: 'user-c', roles: ['CONTRIBUTOR'] as Role[] });
    expect((await serviceFor(statusRepo(version), contributor).getInbox()).items).toHaveLength(0);

    const lead = user({ subject: 'user-tl', roles: ['TEAM_LEAD'] as Role[] });
    expect((await serviceFor(statusRepo(version), lead).getInbox()).items).toHaveLength(0);
  });

  it('does not generate from a Draft, Missing or Reopened current cell', async () => {
    const version = [statusVersion({ release: 'RED', hasBlocker: true })];
    for (const state of ['DRAFT', 'REOPENED'] as UpdateState[]) {
      const repo = statusRepo(version, { state });
      expect((await serviceFor(repo, leader()).getInbox()).items).toHaveLength(0);
    }
    // Missing: no current doc at all.
    const missing = new FakeRepo({
      checkpoints: [checkpoint({ dueOffsetMs: 12 * HOUR })],
      teams: [TEAM],
      versions: version,
    });
    expect((await serviceFor(missing, leader()).getInbox()).items).toHaveLength(0);
  });

  it('does not generate from a closed historical checkpoint', async () => {
    const repo = new FakeRepo({
      // Window fully closed an hour ago.
      checkpoints: [
        checkpoint({ dueOffsetMs: -2 * DAY, closesAt: new Date(NOW - HOUR).toISOString() }),
      ],
      states: { [docKey('mmm-a', 'S14', 'C14-1')]: 'SUBMITTED' },
      teams: [TEAM],
      versions: [statusVersion({ release: 'RED' })],
    });
    expect((await serviceFor(repo, leader()).getInbox()).items).toHaveLength(0);
  });

  it('evaluates only the LATEST submitted version, ignoring older ones', async () => {
    // v1 (older) was Red; v2 (newest) is Green with no blocker/ask -> no alert.
    const repo = statusRepo([
      statusVersion({ id: 'v1', versionNumber: 1, release: 'RED', hasBlocker: true }),
      statusVersion({ id: 'v2', versionNumber: 2, release: 'GREEN' }),
    ]);
    expect((await serviceFor(repo, leader()).getInbox()).items).toHaveLength(0);
  });

  it('deep-links to the exact latest submitted version in Leadership View', async () => {
    const repo = statusRepo([
      statusVersion({ id: 'v1', versionNumber: 1, release: 'GREEN' }),
      statusVersion({ id: 'v2', versionNumber: 2, hasBlocker: true }),
    ]);
    const inbox = await serviceFor(repo, leader()).getInbox();

    expect(inbox.items[0]?.deepLink).toEqual({
      view: 'leadership',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'mmm-a',
      sprintId: 'S14',
      weekNumber: 1,
      versionId: 'v2',
    });
  });

  it('is idempotent across repeated inbox loads', async () => {
    const repo = statusRepo([statusVersion({ release: 'RED', hasBlocker: true })]);
    const service = serviceFor(repo, leader());
    await service.getInbox();
    await service.getInbox();
    const inbox = await service.getInbox();
    expect(inbox.items).toHaveLength(2); // RELEASE_RED + OPEN_BLOCKER, no duplicates
    expect(repo.notifications.size).toBe(2);
  });

  it('isolates programmes: a leader sees no alerts for another programme', async () => {
    const repo = statusRepo([statusVersion({ release: 'RED' })]); // versions are in vsdd
    const otherLeader = leader({ subject: 'user-other', programmeId: 'other' });
    expect((await serviceFor(repo, otherLeader).getInbox()).items).toHaveLength(0);
  });

  it('marks a status alert read and clears the unread count', async () => {
    const repo = statusRepo([statusVersion({ release: 'RED' })]);
    const service = serviceFor(repo, leader());
    const { items } = await service.getInbox();

    await service.markRead(items[0]!.id);
    const after = await service.getInbox();
    expect(after.unreadCount).toBe(0);
    expect(after.items[0]?.readAt).toBeDefined();
  });

  it('keys alerts by version: a newer version with the same condition raises a new unread alert', async () => {
    // V1 is submitted with Red release confidence.
    const repo = statusRepo([statusVersion({ id: 'v1', versionNumber: 1, release: 'RED' })]);
    const service = serviceFor(repo, leader());

    // (1) V1 creates the alert, deep-linking to V1.
    const first = await service.getInbox();
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.type).toBe('RELEASE_RED');
    expect(first.items[0]?.deepLink.versionId).toBe('v1');

    // (2) A repeated load does not duplicate the V1 alert (idempotent).
    expect((await service.getInbox()).items).toHaveLength(1);

    // (3) V2 (a newer submission) with the SAME Red condition raises a separate,
    // still-unread alert rather than being suppressed as a duplicate.
    repo.pushVersion(statusVersion({ id: 'v2', versionNumber: 2, release: 'RED' }));
    const afterV2 = await service.getInbox();
    expect(afterV2.items).toHaveLength(2);
    expect(afterV2.unreadCount).toBe(2);

    // (4) The new alert deep-links to V2.
    const v2Alert = afterV2.items.find((n) => n.deepLink.versionId === 'v2');
    expect(v2Alert?.type).toBe('RELEASE_RED');
    expect(v2Alert?.readAt).toBeUndefined();
  });
});
