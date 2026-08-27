/**
 * Auth route tests (Phase 8, task 8.1): cookie handling + error mapping.
 *
 * Uses Fastify `inject` with a fake {@link AuthApi}. Proves the login route puts
 * the opaque token ONLY in an HttpOnly/SameSite cookie (never the body), logout
 * clears it, and service errors map to the §6 envelope with the right status.
 */
import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../domain/identity.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { AuthApi, LoginResult } from '../services/authService.js';
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

function build(api: AuthApi, secureCookies = false) {
  return buildServer(
    {
      checkReadiness: async () => true,
      auth: api,
      authConfig: { secureCookies, sessionTtlSeconds: 3600 },
    },
    { logLevel: 'silent' },
  );
}

function fakeApi(overrides: Partial<AuthApi> = {}): AuthApi {
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
    ...overrides,
  };
}

describe('auth routes', () => {
  it('POST /auth/register returns 201 with the PENDING public user', async () => {
    const app = build(fakeApi());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { displayName: 'U One', email: 'u1@example.com', password: 'a-good-password' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('PENDING');
    await app.close();
  });

  it('POST /auth/login sets an HttpOnly session cookie and never returns the token', async () => {
    const app = build(fakeApi());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u1@example.com', password: 'a-good-password' },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toContain('vsdd_session=opaque-session-token-value');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    // The token is not in the response body.
    expect(res.body).not.toContain('opaque-session-token-value');
    await app.close();
  });

  it('marks the cookie Secure when secureCookies is enabled', async () => {
    const app = build(fakeApi(), true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u1@example.com', password: 'a-good-password' },
    });
    expect(res.headers['set-cookie'] as string).toContain('Secure');
    await app.close();
  });

  it('POST /auth/logout clears the cookie', async () => {
    const app = build(fakeApi());
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie'] as string).toContain('Max-Age=0');
    await app.close();
  });

  it('maps AUTH_FAILED to a 401 error envelope', async () => {
    const app = build(
      fakeApi({
        login: async () => {
          throw new ApiError('AUTH_FAILED', 'Email or password is incorrect.');
        },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u1@example.com', password: 'nope-nope-nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_FAILED');
    await app.close();
  });

  it('maps RATE_LIMITED to a 429 error envelope', async () => {
    const app = build(
      fakeApi({
        login: async () => {
          throw new ApiError('RATE_LIMITED', 'Too many attempts.');
        },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'u1@example.com', password: 'a-good-password' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('RATE_LIMITED');
    await app.close();
  });
});
