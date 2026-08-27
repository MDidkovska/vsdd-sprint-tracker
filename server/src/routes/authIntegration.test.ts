/**
 * End-to-end local-auth integration (Phase 8) against a real MongoDB.
 *
 * Builds the full server exactly as `index.ts` wires it (real services + real
 * authenticator + real Mongo adapter) and drives the whole lifecycle over HTTP:
 * bootstrap admin → register → login (pending) → admin approve → access granted
 * on the next request → suspend → access revoked. Also asserts login failure,
 * duplicate registration, and that no password or session token appears in an
 * API response or the audit trail.
 *
 * Uses an in-process single-node replica set (transactions are required by the
 * shared submit/reopen paths) or an external MONGO_TEST_URI when provided.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SessionAuthenticator } from '../auth/authenticator.js';
import { Argon2idHasher } from '../auth/passwordHasher.js';
import { hashSessionToken } from '../auth/session.js';
import { RateLimiter } from '../auth/rateLimiter.js';
import { requestAuthContext } from '../auth/requestContext.js';
import { buildReferenceData, PROGRAMME_ID } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { AdminService } from '../services/adminService.js';
import { AuthService } from '../services/authService.js';
import { bootstrapAdmin } from '../services/bootstrapAdmin.js';
import { DraftService } from '../services/draftService.js';
import { HierarchyService } from '../services/hierarchyService.js';
import { SubmitService } from '../services/submitService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let mongoUri: string;
const DB_NAME = 'vsdd_auth_it';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    mongoUri = process.env.MONGO_TEST_URI;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoUri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri: mongoUri, dbName: DB_NAME });
  await repository.seedReferenceData(buildReferenceData());

  const hasher = new Argon2idHasher();
  const authService = new AuthService({
    identity: repository,
    hasher,
    registerLimiter: new RateLimiter({ max: 100, windowMs: 60_000 }),
    loginLimiter: new RateLimiter({ max: 100, windowMs: 60_000 }),
    sessionTtlMs: 3600_000,
  });
  const adminService = new AdminService({
    identity: repository,
    reference: repository,
    auth: requestAuthContext,
  });
  const authenticator = new SessionAuthenticator(repository, repository, repository);

  app = buildServer(
    {
      checkReadiness: async () => true,
      hierarchy: new HierarchyService(repository, requestAuthContext),
      drafts: new DraftService(repository, requestAuthContext),
      submits: new SubmitService(repository, requestAuthContext),
      auth: authService,
      admin: adminService,
      authenticator,
      authConfig: { secureCookies: false, sessionTtlSeconds: 3600 },
    },
    { logLevel: 'silent' },
  );

  // The first admin (created out-of-band by the bootstrap command).
  await bootstrapAdmin(
    { identity: repository, hasher },
    { email: 'admin@vsdd.test', displayName: 'Root Admin', password: 'admin-password-1', programmeId: PROGRAMME_ID },
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await repository?.close();
  await replSet?.stop();
});

/** Extract the session cookie value from a Set-Cookie header. */
function sessionCookie(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!; // "vsdd_session=<token>"
}

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

describe('local-auth end-to-end', () => {
  it('runs the full register → approve → access → suspend lifecycle', async () => {
    const adminCookie = await login('admin@vsdd.test', 'admin-password-1');

    // 1. Self-registration -> PENDING, no password hash in the response.
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Casey Contributor',
        email: 'casey@vsdd.test',
        password: 'casey-password-1',
        requestedTeam: 'PTSB-VSDD MMM A',
      },
    });
    expect(register.statusCode).toBe(201);
    const created = register.json();
    expect(created.status).toBe('PENDING');
    // The register response is the neutral acknowledgement only — it never
    // carries the stored account id or any account projection (task 10.3).
    expect(Object.keys(created).sort()).toEqual(['email', 'status']);
    expect(created).not.toHaveProperty('id');
    expect(register.body).not.toContain('passwordHash');
    expect(register.body).not.toContain('casey-password-1');
    // The stored account id is obtained via the repository, not the response
    // (the response no longer exposes it — anti-enumeration, task 10.3).
    const userId = (await repository.getUserByEmail('casey@vsdd.test'))!.id;

    // 2. A duplicate registration must be INDISTINGUISHABLE from a brand-new
    //    one (anti-enumeration, task 10.3 / design.md §13): same 201 status and
    //    the same neutral body shape, and the response must not disclose that
    //    the email is already taken. Register with a DIFFERENT display name and
    //    password to prove none of the stored account is echoed back.
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Casey Again',
        email: 'casey@vsdd.test',
        password: 'another-password',
        requestedTeam: 'PTSB-VSDD MMM A',
      },
    });
    expect(dup.statusCode).toBe(register.statusCode);
    expect(dup.statusCode).toBe(201);
    expect(dup.json().status).toBe('PENDING');
    expect(Object.keys(dup.json()).sort()).toEqual(Object.keys(created).sort());
    expect(dup.json()).toEqual(created);
    expect(dup.body).not.toContain('EMAIL_TAKEN');
    expect(dup.body).not.toContain('already exists');
    expect(dup.body).not.toContain(userId); // stored id never leaks
    expect(dup.body).not.toContain('Casey Again'); // display name never echoed

    // The original account is preserved: same id/status, and only ONE account
    // exists for that email (the duplicate never created a second one).
    const afterDup = await repository.getUserByEmail('casey@vsdd.test');
    expect(afterDup!.id).toBe(userId);
    expect(afterDup!.status).toBe('PENDING');

    // 3. Pending user can sign in and see /me, but is denied programme data.
    const userCookie = await login('casey@vsdd.test', 'casey-password-1');
    const mePending = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: userCookie } });
    expect(mePending.statusCode).toBe(200);
    expect(mePending.json().status).toBe('PENDING');

    const deniedWhilePending = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/mmm-a/updates/C14-1',
      headers: { cookie: userCookie },
    });
    expect(deniedWhilePending.statusCode).toBe(403);

    // 4. Admin sees the pending user (no password hash) and approves + assigns.
    const pendingList = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?status=PENDING',
      headers: { cookie: adminCookie },
    });
    expect(pendingList.statusCode).toBe(200);
    expect(pendingList.body).not.toContain('passwordHash');
    expect((pendingList.json() as Array<{ id: string }>).some((u) => u.id === userId)).toBe(true);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${userId}/approve`,
      headers: { cookie: adminCookie },
      payload: { programmeId: PROGRAMME_ID, teamIds: ['mmm-a'], roles: ['TEAM_LEAD'] },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe('ACTIVE');

    // 5. Approval takes effect on the user's NEXT request (same session).
    const meActive = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: userCookie } });
    expect(meActive.json().status).toBe('ACTIVE');
    expect(meActive.json().roles).toEqual(['TEAM_LEAD']);

    const assignedRead = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/mmm-a/updates/C14-1',
      headers: { cookie: userCookie },
    });
    expect(assignedRead.statusCode).toBe(200);

    // 6. Team scoping: an UNASSIGNED team is denied.
    const unassignedRead = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/o24-desktop/updates/C14-1',
      headers: { cookie: userCookie },
    });
    expect(unassignedRead.statusCode).toBe(403);

    // 7. Suspension revokes access immediately (next request is 401).
    const suspend = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${userId}/suspend`,
      headers: { cookie: adminCookie },
    });
    expect(suspend.statusCode).toBe(200);
    const afterSuspend = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: userCookie } });
    expect(afterSuspend.statusCode).toBe(401);

    // 8. Neither the password nor any session token leaked into the audit trail.
    const audit = await repository.listAuditForAggregate(userId);
    expect(audit.some((e) => e.action === 'USER_REGISTERED')).toBe(true);
    expect(audit.some((e) => e.action === 'USER_APPROVED')).toBe(true);
    expect(audit.some((e) => e.action === 'USER_SUSPENDED')).toBe(true);
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain('casey-password-1');
    expect(auditJson).not.toContain(userCookie.split('=')[1]);
  });

  it('rejects a wrong password with 401 AUTH_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@vsdd.test', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_FAILED');
  });

  it('logout revokes the admin session', async () => {
    const adminCookie = await login('admin@vsdd.test', 'admin-password-1');
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: adminCookie } });
    expect(logout.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: adminCookie } });
    expect(after.statusCode).toBe(401);
  });

  it('persists account, assignment and session through Mongo across logout/login and a fresh repository', async () => {
    // register -> PENDING
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { displayName: 'Rory Roundtrip', email: 'rory@vsdd.test', password: 'rory-password-1' },
    });
    expect(register.statusCode).toBe(201);
    // The register response no longer carries the stored id (task 10.3); look
    // it up via the repository instead.
    const userId = (await repository.getUserByEmail('rory@vsdd.test'))!.id;

    // Admin approve + assign.
    const adminCookie = await login('admin@vsdd.test', 'admin-password-1');
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${userId}/approve`,
      headers: { cookie: adminCookie },
      payload: { programmeId: PROGRAMME_ID, teamIds: ['mmm-a'], roles: ['TEAM_LEAD'] },
    });
    expect(approve.statusCode).toBe(200);

    // logout then login again -> a brand-new persisted session.
    const firstCookie = await login('rory@vsdd.test', 'rory-password-1');
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: firstCookie } });
    const secondCookie = await login('rory@vsdd.test', 'rory-password-1');
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: secondCookie } });
    expect(me.json().status).toBe('ACTIVE');
    const draft = await app.inject({
      method: 'GET',
      url: '/api/v1/teams/mmm-a/updates/C14-1',
      headers: { cookie: secondCookie },
    });
    expect(draft.statusCode).toBe(200);

    // Prove persistence independent of in-memory state: read via a FRESH
    // repository connected to the same Mongo database.
    const fresh = await MongoDocumentRepository.connect({ uri: mongoUri, dbName: DB_NAME });
    try {
      const storedUser = await fresh.getUserById(userId);
      expect(storedUser?.status).toBe('ACTIVE');
      const assignment = await fresh.getAssignment(userId);
      expect(assignment?.roles).toContain('TEAM_LEAD');
      expect(assignment?.teamIds).toContain('mmm-a');

      // The current session row is persisted (looked up by the token hash).
      const token = secondCookie.split('=')[1]!;
      const session = await fresh.getSession(hashSessionToken(token));
      expect(session?.userId).toBe(userId);

      // The decision history is persisted and queryable, newest-first.
      const audit = await fresh.queryAudit({ userId, limit: 50, offset: 0 });
      const actions = audit.events.map((e) => e.action);
      expect(actions).toContain('USER_REGISTERED');
      expect(actions).toContain('USER_APPROVED');
      expect(actions).toContain('ASSIGNMENT_CHANGED');
    } finally {
      await fresh.close();
    }
  });
});
