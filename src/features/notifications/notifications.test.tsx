/**
 * Focused tests for in-app notifications (tasks 9.1 + 9.2).
 *
 * Part A exercises the mock repository's lazy, idempotent DEADLINE reminder
 * generation (task 9.1) against the real seed data with an injected clock:
 * DUE_SOON, OVERDUE, submitted suppression, deduplication, read state, the
 * non-editor/recipient rule, and the task-9.3 deep link. These use a pure
 * EDITOR principal (Contributor) so only deadline reminders are produced.
 *
 * Part B exercises the STATUS ALERTS (task 9.2) — Red release confidence, open
 * Blockers and Leadership asks — generated for an ACTIVE Leadership/Admin
 * principal from the latest submitted version in the current checkpoint:
 * per-type generation, combined conditions, recipient roles (Auditor/editor get
 * none), deduplication, read state and the exact-version deep link.
 *
 * Part C renders the NotificationBell and proves the unread count, the inbox
 * list, mark-all-read, that both families render, and that opening a
 * notification deep-links (task 9.3) — a reminder to the team/sprint/week and a
 * status alert to the exact submitted version — via the selection provider.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRepository } from '../../api/mockRepository';
import { ASSIGNED_TEAM_IDS } from '../../api/seed';
import type { CurrentUser, Role } from '../../api/repository';
import type { Notification, NotificationInbox } from '../../domain/notifications';
import { renderWithProviders } from '../../test/renderApp';
import { NotificationBell } from './NotificationBell';
import { NotificationError, type NotificationClient } from './notificationClient';

/** A fixed instant 6 hours before the C14-1 deadline (2026-08-28T16:00Z). */
const DUE_SOON_NOW = () => new Date('2026-08-28T10:00:00Z');
/** A fixed instant 2 hours after the C14-1 deadline, still within the window. */
const OVERDUE_NOW = () => new Date('2026-08-28T18:00:00Z');

function contributor(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    subject: 'user-contrib',
    email: 'c@vsdd.test',
    displayName: 'Cara Contributor',
    initials: 'CC',
    roleLabel: 'Team Contributor',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles: ['CONTRIBUTOR'] as Role[],
    assignedTeamIds: ['mmm-b'],
    canViewAll: false,
    ...overrides,
  };
}

/**
 * A pure EDITOR (Contributor) assigned to every seeded team, so deadline
 * reminders are produced for the Draft/Missing teams while Submitted teams
 * still produce none — and no status alerts appear (an editor is not a
 * Leadership/Admin recipient).
 */
function editor(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return contributor({
    subject: 'user-editor',
    roles: ['CONTRIBUTOR'] as Role[],
    canViewAll: false,
    assignedTeamIds: ASSIGNED_TEAM_IDS,
    ...overrides,
  });
}

/** An ACTIVE Leadership principal assigned to the vsdd programme (status alerts). */
function leader(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return contributor({
    subject: 'user-lead',
    roleLabel: 'Programme Leadership',
    roles: ['LEADERSHIP'] as Role[],
    canViewAll: true,
    assignedTeamIds: [],
    ...overrides,
  });
}

const STATUS_TYPES: Notification['type'][] = ['RELEASE_RED', 'OPEN_BLOCKER', 'LEADERSHIP_ASK'];
const statusAlerts = (inbox: NotificationInbox): Notification[] =>
  inbox.items.filter((n) => STATUS_TYPES.includes(n.type));

describe('mock repository — deadline reminder generation (task 9.1)', () => {
  it('generates DUE_SOON reminders only for Draft/Missing teams, never submitted ones', async () => {
    // The editor is assigned to every team except o24-desktop. At the C14-1
    // checkpoint only mmm-b and oah-sales are Draft; the rest are Submitted.
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: editor() });
    const inbox = await repo.getNotifications();

    const teamIds = inbox.items.map((n) => n.teamId).sort();
    expect(teamIds).toEqual(['mmm-b', 'oah-sales']);
    expect(inbox.items.every((n) => n.type === 'DUE_SOON')).toBe(true);
    expect(inbox.unreadCount).toBe(2);
    // Submitted teams (e.g. mmm-a) never produce a reminder — stop after submission.
    expect(inbox.items.some((n) => n.teamId === 'mmm-a')).toBe(false);
  });

  it('generates OVERDUE reminders once the deadline has passed', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: OVERDUE_NOW, user: editor() });
    const inbox = await repo.getNotifications();
    expect(inbox.items.length).toBe(2);
    expect(inbox.items.every((n) => n.type === 'OVERDUE')).toBe(true);
  });

  it('is idempotent: reloading the inbox never duplicates reminders', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: editor() });
    await repo.getNotifications();
    await repo.getNotifications();
    const inbox = await repo.getNotifications();
    expect(inbox.items.length).toBe(2);
  });

  it('marks one notification read and then all read', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: editor() });
    const { items } = await repo.getNotifications();

    const updated = await repo.markNotificationRead(items[0]!.id);
    expect(updated.readAt).toBeDefined();
    expect((await repo.getNotifications()).unreadCount).toBe(1);

    const result = await repo.markAllNotificationsRead();
    expect(result.updated).toBe(1);
    expect((await repo.getNotifications()).unreadCount).toBe(0);
  });

  it('attaches a task-9.3 deep link to the exact team/sprint/week', async () => {
    const repo = createMockRepository({
      latencyMs: 0,
      now: DUE_SOON_NOW,
      user: contributor(),
    });
    const inbox = await repo.getNotifications();
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]?.deepLink).toEqual({
      view: 'team',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'mmm-b',
      sprintId: 'S14',
      weekNumber: 1,
    });
  });

  it('does not generate DEADLINE reminders for a non-editor (Leadership-only) recipient', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: leader() });
    const inbox = await repo.getNotifications();
    // A leader still receives status alerts (task 9.2) but never a deadline reminder.
    expect(inbox.items.some((n) => n.type === 'DUE_SOON' || n.type === 'OVERDUE')).toBe(false);
  });

  it('rejects marking a notification the caller does not own (recipient isolation)', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: editor() });
    await expect(repo.markNotificationRead('someone-else::mmm-b::C14-1::DUE_SOON')).rejects.toThrow();
  });
});

describe('mock repository — status alerts (task 9.2)', () => {
  it('raises OPEN_BLOCKER and LEADERSHIP_ASK from the latest submitted versions', async () => {
    // At C14-1 the submitted seed teams carry: mmm-a an open BLOCKER + a
    // leadership ask; oah-ils and o24-app a leadership ask; the rest none.
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: leader() });
    const alerts = statusAlerts(await repo.getNotifications());

    const blockers = alerts.filter((n) => n.type === 'OPEN_BLOCKER');
    const asks = alerts.filter((n) => n.type === 'LEADERSHIP_ASK');
    expect(blockers.map((n) => n.teamId)).toEqual(['mmm-a']);
    expect(asks.map((n) => n.teamId).sort()).toEqual(['mmm-a', 'o24-app', 'oah-ils']);
    // No Red release confidence is submitted at C14-1 in the seed.
    expect(alerts.some((n) => n.type === 'RELEASE_RED')).toBe(false);
  });

  it('combines conditions on one team into distinct alerts (mmm-a: blocker + ask)', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: leader() });
    const mmmA = statusAlerts(await repo.getNotifications()).filter((n) => n.teamId === 'mmm-a');
    expect(mmmA.map((n) => n.type).sort()).toEqual(['LEADERSHIP_ASK', 'OPEN_BLOCKER']);
    expect(new Set(mmmA.map((n) => n.id)).size).toBe(2);
  });

  it('deep-links a status alert to the exact latest submitted version in Leadership View', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: leader() });
    const blocker = statusAlerts(await repo.getNotifications()).find((n) => n.type === 'OPEN_BLOCKER');
    expect(blocker?.deepLink).toEqual({
      view: 'leadership',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'mmm-a',
      sprintId: 'S14',
      weekNumber: 1,
      versionId: 'mmm-a-S14-C14-1-v1',
    });
  });

  it('sends status alerts to an ACTIVE Admin, but never to an Auditor or an editor', async () => {
    const admin = createMockRepository({
      latencyMs: 0,
      now: DUE_SOON_NOW,
      user: leader({ subject: 'user-admin', roles: ['ADMIN'] as Role[] }),
    });
    expect(statusAlerts(await admin.getNotifications()).length).toBeGreaterThan(0);

    const auditor = createMockRepository({
      latencyMs: 0,
      now: DUE_SOON_NOW,
      user: leader({ subject: 'user-aud', roles: ['AUDITOR'] as Role[] }),
    });
    expect((await auditor.getNotifications()).items).toHaveLength(0);

    // A pure editor gets deadline reminders but no status alerts.
    const theEditor = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: editor() });
    expect(statusAlerts(await theEditor.getNotifications())).toHaveLength(0);
  });

  it('is idempotent and records read state for status alerts', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: leader() });
    const first = statusAlerts(await repo.getNotifications());
    await repo.getNotifications();
    const second = statusAlerts(await repo.getNotifications());
    expect(second).toHaveLength(first.length); // no duplicates on reload

    const before = (await repo.getNotifications()).unreadCount;
    await repo.markNotificationRead(first[0]!.id);
    expect((await repo.getNotifications()).unreadCount).toBe(before - 1);
  });

  it('does not raise status alerts from a closed historical checkpoint', async () => {
    // Well after every S14 window has closed: no open checkpoint -> no alerts.
    const afterClose = () => new Date('2026-09-30T10:00:00Z');
    const repo = createMockRepository({ latencyMs: 0, now: afterClose, user: leader() });
    expect(statusAlerts(await repo.getNotifications())).toHaveLength(0);
  });
});

describe('NotificationBell (task 9.1)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('shows the unread count and lists the reminder', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: contributor() });
    renderWithProviders(<NotificationBell />, { repository: repo });

    const trigger = await screen.findByRole('button', { name: /1 unread/i });
    await userEvent.setup().click(trigger);

    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('Due soon')).toBeInTheDocument();
    // The context line (distinct from the body) shows team · sprint · week.
    expect(screen.getByText(/MMM B · Sprint 14 · Week 1/)).toBeInTheDocument();
  });

  it('deep-links to the exact context (task 9.3) when a reminder is opened', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: contributor() });
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />, { repository: repo });

    await user.click(await screen.findByRole('button', { name: /1 unread/i }));
    await user.click(screen.getByText('Update due soon'));

    await waitFor(() => {
      const hash = window.location.hash;
      expect(hash).toContain('view=team');
      expect(hash).toContain('team=mmm-b');
      expect(hash).toContain('sprint=S14');
      expect(hash).toContain('week=1');
    });
  });

  it('marks all read from the inbox, clearing the unread badge', async () => {
    const repo = createMockRepository({ latencyMs: 0, now: DUE_SOON_NOW, user: contributor() });
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />, { repository: repo });

    await user.click(await screen.findByRole('button', { name: /1 unread/i }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /none unread/i })).toBeInTheDocument(),
    );
  });

  it('shows an explicit connection-error state without falling back to mock data', async () => {
    const failing: NotificationClient = {
      getInbox: () =>
        Promise.reject(new NotificationError('CONNECTION_ERROR', 'Could not reach the server.')),
      markRead: () => Promise.reject(new NotificationError('CONNECTION_ERROR', 'unreachable')),
      markAllRead: () => Promise.resolve({ updated: 0 }),
    };
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />, { notificationClient: failing });

    await user.click(await screen.findByRole('button', { name: /Notifications/i }));
    expect(await screen.findByText(/Couldn.t load notifications/i)).toBeInTheDocument();
    // No reminder content is shown — the app never falls back to mock data.
    expect(screen.queryByText('Due soon')).not.toBeInTheDocument();
  });
});

/** Build a status-alert notification (task 9.2) for the bell tests. */
function statusNotification(
  type: Notification['type'],
  over: Partial<Notification> = {},
): Notification {
  const teamId = over.teamId ?? 'mmm-a';
  const titles: Record<string, string> = {
    RELEASE_RED: 'Release confidence is Red',
    OPEN_BLOCKER: 'Open blocker raised',
    LEADERSHIP_ASK: 'Leadership ask raised',
  };
  return {
    id: over.id ?? `user-lead::${teamId}::C14-1::${type}`,
    programmeId: 'vsdd',
    recipientSubject: 'user-lead',
    teamId,
    teamName: over.teamName ?? 'PTSB-VSDD MMM A',
    sprintId: 'S14',
    sprintLabel: 'Sprint 14',
    checkpointId: 'C14-1',
    weekNumber: 1,
    type,
    title: titles[type] ?? 'Update alert',
    body: `Alert for ${teamId}.`,
    dueAt: '2026-08-28T16:00:00Z',
    deepLink: {
      view: 'leadership',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId,
      sprintId: 'S14',
      weekNumber: 1,
      versionId: over.deepLink?.versionId ?? 'mmm-a-S14-C14-1-v1',
    },
    createdAt: '2026-08-28T10:00:00Z',
    ...over,
  };
}

/** A NotificationClient stub backed by a fixed set of notifications. */
function stubClient(items: Notification[]): NotificationClient {
  const store = new Map(items.map((i) => [i.id, { ...i }]));
  const inbox = () => {
    const all = [...store.values()];
    return { items: all, unreadCount: all.filter((n) => !n.readAt).length };
  };
  return {
    getInbox: async () => inbox(),
    markRead: async (id: string) => {
      const n = store.get(id);
      if (!n) throw new NotificationError('NOT_FOUND', 'not found');
      n.readAt = new Date('2026-08-28T11:00:00Z').toISOString();
      return { ...n };
    },
    markAllRead: async () => {
      let updated = 0;
      for (const n of store.values()) {
        if (!n.readAt) {
          n.readAt = new Date('2026-08-28T11:00:00Z').toISOString();
          updated += 1;
        }
      }
      return { updated };
    },
  };
}

describe('NotificationBell — status alerts (task 9.2)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders a label for each status-alert type', async () => {
    const client = stubClient([
      statusNotification('RELEASE_RED'),
      statusNotification('OPEN_BLOCKER'),
      statusNotification('LEADERSHIP_ASK'),
    ]);
    renderWithProviders(<NotificationBell />, { notificationClient: client });

    await userEvent.setup().click(await screen.findByRole('button', { name: /3 unread/i }));
    expect(screen.getByText('Release Red')).toBeInTheDocument();
    expect(screen.getByText('Blocker')).toBeInTheDocument();
    expect(screen.getByText('Leadership ask')).toBeInTheDocument();
  });

  it('deep-links a status alert to the exact submitted version in Leadership View', async () => {
    const client = stubClient([
      statusNotification('RELEASE_RED', {
        teamId: 'oah-sales',
        teamName: 'PTSB-VSDD OAH Sales',
        deepLink: {
          view: 'leadership',
          programmeId: 'vsdd',
          streamId: 'OAH',
          teamId: 'oah-sales',
          sprintId: 'S14',
          weekNumber: 1,
          versionId: 'oah-sales-S14-C14-1-v2',
        },
      }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell />, { notificationClient: client });

    await user.click(await screen.findByRole('button', { name: /1 unread/i }));
    await user.click(screen.getByText('Release confidence is Red'));

    await waitFor(() => {
      const hash = window.location.hash;
      expect(hash).toContain('view=leadership');
      expect(hash).toContain('team=oah-sales');
      expect(hash).toContain('version=oah-sales-S14-C14-1-v2');
    });
  });
});
