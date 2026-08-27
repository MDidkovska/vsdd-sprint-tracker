/**
 * HTTP tests for the notification endpoints (task 9.1).
 *
 * Wires a real {@link SessionAuthenticator} over an in-memory identity store and
 * a fake {@link NotificationApi} through Fastify `inject` (no MongoDB), so the
 * assertions isolate route wiring + authentication:
 *  - 401 when unauthenticated on the list and mark-read routes;
 *  - 403 for a PENDING account (authed-active gate);
 *  - 200 inbox for an ACTIVE account, and 200 for mark-read / read-all.
 *
 * Per-recipient scoping and reminder logic are covered by the service unit
 * tests; here we prove the endpoints are authenticated and correctly wired.
 */
import { describe, expect, it } from 'vitest';
import { SessionAuthenticator } from '../auth/authenticator.js';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE } from '../auth/session.js';
import type { Assignment, UserAccount } from '../domain/accounts.js';
import type { Role } from '../domain/identity.js';
import type { Notification, NotificationInbox } from '../domain/notifications.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { buildServer } from '../server.js';
import type { NotificationApi } from '../services/notificationService.js';

function sampleNotification(): Notification {
  return {
    id: 'user-a::mmm-a::C14-1::DUE_SOON',
    programmeId: 'vsdd',
    recipientSubject: 'user-a',
    teamId: 'mmm-a',
    teamName: 'PTSB-VSDD MMM A',
    sprintId: 'S14',
    sprintLabel: 'Sprint 14',
    checkpointId: 'C14-1',
    weekNumber: 1,
    type: 'DUE_SOON',
    title: 'Update due soon',
    body: 'The update is due within the next 24 hours.',
    dueAt: '2026-08-28T16:00:00Z',
    deepLink: {
      view: 'team',
      programmeId: 'vsdd',
      streamId: 'MMM',
      teamId: 'mmm-a',
      sprintId: 'S14',
      weekNumber: 1,
    },
    createdAt: '2026-08-28T10:00:00Z',
  };
}

const fakeNotifications: NotificationApi = {
  getInbox: async (): Promise<NotificationInbox> => ({
    items: [sampleNotification()],
    unreadCount: 1,
  }),
  markRead: async (id: string) => ({ ...sampleNotification(), id, readAt: '2026-08-28T11:00:00Z' }),
  markAllRead: async () => ({ updated: 1 }),
};

function makeUser(id: string, status: UserAccount['status']): UserAccount {
  const now = new Date().toISOString();
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    passwordHash: '$argon2id$fake',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedSession(
  repo: InMemoryIdentityRepository,
  user: UserAccount,
  roles: Role[],
  teamIds: string[] = [],
): Promise<string> {
  await repo.insertUser(user);
  const assignment: Assignment = {
    id: user.id,
    userId: user.id,
    programmeId: 'vsdd',
    teamIds,
    roles,
    updatedAt: new Date().toISOString(),
  };
  await repo.upsertAssignment(assignment);
  const token = generateSessionToken();
  await repo.createSession({
    id: hashSessionToken(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  return token;
}

function build(repo: InMemoryIdentityRepository) {
  return buildServer(
    {
      checkReadiness: async () => true,
      notifications: fakeNotifications,
      authenticator: new SessionAuthenticator(repo, repo, repo),
      authConfig: { secureCookies: false, sessionTtlSeconds: 3600 },
    },
    { logLevel: 'silent' },
  );
}

function cookie(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

describe('notification endpoints (task 9.1)', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = build(new InMemoryIdentityRepository());
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/notifications/n1/read', payload: {} }))
        .statusCode,
    ).toBe(401);
    await app.close();
  });

  it('denies a PENDING account (403)', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('p1', 'PENDING'), []);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie: cookie(token) },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns the inbox for an ACTIVE recipient', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('c1', 'ACTIVE'), ['CONTRIBUTOR'], ['mmm-a']);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { cookie: cookie(token) },
    });
    expect(res.statusCode).toBe(200);
    const inbox = res.json() as NotificationInbox;
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0]?.deepLink.teamId).toBe('mmm-a');
    await app.close();
  });

  it('marks a notification read and marks all read for an ACTIVE recipient', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('c2', 'ACTIVE'), ['CONTRIBUTOR'], ['mmm-a']);
    const ck = { cookie: cookie(token) };

    const read = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/user-a::mmm-a::C14-1::DUE_SOON/read',
      headers: ck,
      payload: {},
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as Notification).readAt).toBeDefined();

    const all = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      headers: ck,
      payload: {},
    });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { updated: number }).updated).toBe(1);
    await app.close();
  });
});
