/**
 * CSRF protection integration tests (task 10.1).
 *
 * Build the server with CSRF enabled and prove, via Fastify `inject`, that:
 *  - a state-changing request WITHOUT a valid double-submit token is rejected
 *    (403 PERMISSION_DENIED);
 *  - the same request WITH a matching cookie + header token is accepted;
 *  - the token cookie is seeded on a request that does not carry one yet;
 *  - the public register/login bootstrap routes are exempt (no session yet).
 *
 * The auth hook is intentionally not wired here so the test isolates CSRF from
 * session authentication: `logout` is a convenient state-changing route.
 */
import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../domain/identity.js';
import type { AuthApi, LoginResult } from '../services/authService.js';
import { CSRF_COOKIE } from '../auth/csrf.js';
import { buildServer } from '../server.js';

const PRINCIPAL: CurrentUser = {
  subject: 'u1',
  email: 'u1@example.com',
  displayName: 'U One',
  initials: 'UO',
  roleLabel: 'Team Lead',
  status: 'ACTIVE',
  programmeId: 'vsdd',
  roles: ['TEAM_LEAD'],
  assignedTeamIds: ['mmm-a'],
  canViewAll: false,
};

const LOGIN_RESULT: LoginResult = {
  principal: PRINCIPAL,
  token: 'opaque-session-token-value',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function fakeAuthApi(): AuthApi {
  return {
    register: async () => ({
      id: 'u1',
      email: 'u1@example.com',
      displayName: 'U One',
      status: 'PENDING',
      roles: [],
      teamIds: [],
      programmeId: null,
      createdAt: 'now',
      updatedAt: 'now',
    }),
    login: async () => LOGIN_RESULT,
    logout: async () => undefined,
  };
}

function build() {
  return buildServer(
    {
      checkReadiness: async () => true,
      auth: fakeAuthApi(),
      authConfig: { secureCookies: false, sessionTtlSeconds: 3600 },
      csrfProtection: true,
    },
    { logLevel: 'silent' },
  );
}

describe('CSRF protection', () => {
  it('rejects a state-changing request with no CSRF token (403)', async () => {
    const app = build();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    await app.close();
  });

  it('rejects a state-changing request whose header does not match the cookie', async () => {
    const app = build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `${CSRF_COOKIE}=cookie-token`, 'x-csrf-token': 'different-token' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    await app.close();
  });

  it('accepts a state-changing request with a matching double-submit token', async () => {
    const app = build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `${CSRF_COOKIE}=match-token`, 'x-csrf-token': 'match-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it('seeds a readable CSRF cookie when the client does not have one', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toContain(`${CSRF_COOKIE}=`);
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('HttpOnly');
    await app.close();
  });

  it('does not require a CSRF token for register or login (public bootstrap)', async () => {
    const app = build();

    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { displayName: 'U One', email: 'u1@example.com', password: 'a-good-password' },
    });
    expect(register.statusCode).toBe(201);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u1@example.com', password: 'a-good-password' },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });
});
