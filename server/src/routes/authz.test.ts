/**
 * HTTP authentication + authorisation matrix (Phase 8, task 8.6).
 *
 * Exercises the global authentication hook via Fastify `inject` (no MongoDB):
 * a real {@link SessionAuthenticator} over an in-memory identity store, with
 * fake business APIs so the assertions isolate the edge auth behaviour. Covers
 * NEGATIVE authorisation for every protected endpoint:
 *  - 401 when unauthenticated (no/invalid session);
 *  - 403 for a PENDING account on all programme data;
 *  - 403 for a non-admin on every /admin endpoint;
 *  - 403 for a non-leadership caller on the leadership reporting summary.
 * Fine-grained team/role write scoping is covered in writeScopeAuthz.test.ts and
 * the existing reopen/decision/export endpoint suites.
 */
import { describe, expect, it } from 'vitest';
import { SessionAuthenticator } from '../auth/authenticator.js';
import { requestAuthContext } from '../auth/requestContext.js';
import { generateSessionToken, hashSessionToken, SESSION_COOKIE } from '../auth/session.js';
import type { Assignment, UserAccount } from '../domain/accounts.js';
import type { Role } from '../domain/identity.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { buildServer, type ServerDeps } from '../server.js';

/** A business-API stub set: every call resolves so only auth gating shows. */
function fakeBusinessApis(): Partial<ServerDeps> {
  const anyDoc = {} as never;
  return {
    hierarchy: {
      // /me returns the ACTUAL request principal (proves ALS propagation).
      getCurrentUser: async () => requestAuthContext.getCurrentUser(),
      getHierarchy: async () => anyDoc,
      getSprints: async () => [],
    },
    drafts: { getUpdate: async () => anyDoc, saveDraft: async () => anyDoc },
    submits: { submit: async () => anyDoc },
    reopens: { reopen: async () => anyDoc },
    summaries: { getReportingSummary: async () => anyDoc },
    versions: {
      getVersions: async () => [],
      getVersion: async () => anyDoc,
      getAudit: async () => [],
      compareVersions: async () => anyDoc,
    },
    decisions: { recordDecision: async () => anyDoc, getDecisions: async () => [] },
    exports: { createExport: async () => anyDoc },
    auth: {
      register: async () => anyDoc,
      login: async () => anyDoc,
      logout: async () => undefined,
    },
    admin: {
      listUsers: async () => [],
      approve: async () => anyDoc,
      reject: async () => anyDoc,
      updateAssignments: async () => anyDoc,
      suspend: async () => anyDoc,
    },
    auditQuery: {
      list: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    },
  };
}

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
      ...fakeBusinessApis(),
      authenticator: new SessionAuthenticator(repo, repo, repo),
      authConfig: { secureCookies: false, sessionTtlSeconds: 3600 },
    },
    { logLevel: 'silent' },
  );
}

function cookie(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

/** Every protected endpoint (method + url). */
const PROTECTED: Array<{ method: 'GET' | 'POST' | 'PUT'; url: string }> = [
  { method: 'GET', url: '/api/v1/me' },
  { method: 'GET', url: '/api/v1/programmes/vsdd/hierarchy' },
  { method: 'GET', url: '/api/v1/programmes/vsdd/sprints' },
  { method: 'GET', url: '/api/v1/programmes/vsdd/reporting-summary?sprintId=S14&checkpointId=C14-1' },
  { method: 'GET', url: '/api/v1/teams/mmm-a/updates/C14-1' },
  { method: 'PUT', url: '/api/v1/teams/mmm-a/drafts/C14-1' },
  { method: 'POST', url: '/api/v1/teams/mmm-a/drafts/C14-1/submit' },
  { method: 'POST', url: '/api/v1/updates/v1/reopen' },
  { method: 'POST', url: '/api/v1/updates/v1/decisions' },
  { method: 'GET', url: '/api/v1/updates/v1/decisions' },
  { method: 'POST', url: '/api/v1/programmes/vsdd/exports' },
  { method: 'GET', url: '/api/v1/audit' },
  { method: 'GET', url: '/api/v1/admin/users' },
  { method: 'POST', url: '/api/v1/admin/users/u1/approve' },
  { method: 'POST', url: '/api/v1/admin/users/u1/reject' },
  { method: 'PUT', url: '/api/v1/admin/users/u1/assignments' },
  { method: 'POST', url: '/api/v1/admin/users/u1/suspend' },
];

const ADMIN_ENDPOINTS = PROTECTED.filter((e) => e.url.startsWith('/api/v1/admin'));

describe('HTTP auth matrix — unauthenticated', () => {
  it('returns 401 for every protected endpoint with no session', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    for (const ep of PROTECTED) {
      const res = await app.inject({ method: ep.method, url: ep.url, payload: {} });
      expect(res.statusCode, `${ep.method} ${ep.url}`).toBe(401);
      expect(res.json().error.code).toBe('SESSION_EXPIRED');
    }
    await app.close();
  });

  it('returns 401 for an invalid/expired session cookie', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookie('bogus-token') },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('leaves public routes open', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('HTTP auth matrix — PENDING account', () => {
  it('can read /me but is denied all programme data (403)', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('p1', 'PENDING'), []);

    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: cookie(token) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().status).toBe('PENDING');

    for (const ep of PROTECTED.filter((e) => e.url !== '/api/v1/me')) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: {},
        headers: { cookie: cookie(token) },
      });
      expect(res.statusCode, `${ep.method} ${ep.url}`).toBe(403);
    }
    await app.close();
  });
});

describe('HTTP auth matrix — non-admin ACTIVE account', () => {
  it('is denied every /admin endpoint (403)', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('lead1', 'ACTIVE'), ['TEAM_LEAD'], ['mmm-a']);
    for (const ep of ADMIN_ENDPOINTS) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        payload: {},
        headers: { cookie: cookie(token) },
      });
      expect(res.statusCode, `${ep.method} ${ep.url}`).toBe(403);
    }
    await app.close();
  });

  it('denies a contributor the leadership reporting summary (403)', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('c1', 'ACTIVE'), ['CONTRIBUTOR'], ['mmm-a']);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/reporting-summary?sprintId=S14&checkpointId=C14-1',
      headers: { cookie: cookie(token) },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('HTTP auth matrix — audit endpoint (ADMIN/AUDITOR only)', () => {
  async function get(role: Role[]): Promise<number> {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser(`u-${role.join()}`, 'ACTIVE'), role);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/audit',
      headers: { cookie: cookie(token) },
    });
    await app.close();
    return res.statusCode;
  }

  it('allows ADMIN and AUDITOR, denies LEADERSHIP and CONTRIBUTOR', async () => {
    expect(await get(['ADMIN'])).toBe(200);
    expect(await get(['AUDITOR'])).toBe(200);
    expect(await get(['LEADERSHIP'])).toBe(403);
    expect(await get(['CONTRIBUTOR'])).toBe(403);
  });
});

describe('HTTP auth matrix — AUDITOR read access', () => {
  it('allows an auditor to read hierarchy, reporting summary and audit', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const token = await seedSession(repo, makeUser('aud1', 'ACTIVE'), ['AUDITOR']);
    const ck = { cookie: cookie(token) };
    expect((await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/hierarchy', headers: ck })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/reporting-summary?sprintId=S14&checkpointId=C14-1', headers: ck })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit', headers: ck })).statusCode).toBe(200);
    // ...but is denied the admin surface.
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: ck })).statusCode).toBe(403);
    await app.close();
  });
});

describe('HTTP auth matrix — ADMIN + LEADERSHIP allowed', () => {
  it('allows an admin to list users and leadership to read the summary', async () => {
    const repo = new InMemoryIdentityRepository();
    const app = build(repo);
    const adminToken = await seedSession(repo, makeUser('a1', 'ACTIVE'), ['ADMIN']);
    const leadToken = await seedSession(repo, makeUser('l1', 'ACTIVE'), ['LEADERSHIP']);

    const admin = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?status=PENDING',
      headers: { cookie: cookie(adminToken) },
    });
    expect(admin.statusCode).toBe(200);

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/reporting-summary?sprintId=S14&checkpointId=C14-1',
      headers: { cookie: cookie(leadToken) },
    });
    expect(summary.statusCode).toBe(200);
    await app.close();
  });
});
