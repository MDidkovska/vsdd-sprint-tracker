/**
 * Local-account authentication routes (Phase 8, design.md §5a/§6):
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/logout
 *
 * The routes depend only on the {@link AuthApi} contract plus cookie settings,
 * so the server can be tested with a fake API. On a successful login the opaque
 * session token is returned ONLY in an HttpOnly/SameSite cookie (Secure outside
 * local dev) — never in the response body and never for the client JS to store
 * (R1.3). Rate-limit / validation / auth failures surface as the §6 error
 * envelope via the shared error handler.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildClearSessionCookie, buildSessionCookie, readSessionToken } from '../auth/session.js';
import type { LoginInput, RegisterInput } from '../domain/accounts.js';
import type { AuthApi } from '../services/authService.js';

export const API_BASE_PATH = '/api/v1';

export interface AuthRoutesConfig {
  secureCookies: boolean;
  sessionTtlSeconds: number;
}

const REGISTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['displayName', 'email', 'password'],
  properties: {
    displayName: { type: 'string', maxLength: 200 },
    email: { type: 'string', maxLength: 254 },
    password: { type: 'string', maxLength: 512 },
    requestedTeam: { type: 'string', maxLength: 400 },
  },
} as const;

const LOGIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', maxLength: 254 },
    password: { type: 'string', maxLength: 512 },
  },
} as const;

/** A stable per-client key for rate limiting (client IP for the PoC). */
function clientKey(request: FastifyRequest): string {
  return request.ip ?? 'unknown';
}

export function registerAuthRoutes(
  app: FastifyInstance,
  api: AuthApi,
  config: AuthRoutesConfig,
): void {
  app.post<{ Body: RegisterInput }>(
    `${API_BASE_PATH}/auth/register`,
    { schema: { body: REGISTER_SCHEMA } },
    async (request, reply) => {
      // A neutral acknowledgement derived only from the request (never the
      // stored account), so a duplicate email is indistinguishable from a new
      // one (anti-enumeration, task 10.3). The status stays 201 for both.
      const accepted = await api.register(request.body, clientKey(request));
      reply.code(201);
      return accepted;
    },
  );

  app.post<{ Body: LoginInput }>(
    `${API_BASE_PATH}/auth/login`,
    { schema: { body: LOGIN_SCHEMA } },
    async (request, reply) => {
      const result = await api.login(request.body, clientKey(request));
      setSessionCookie(reply, result.token, config);
      // Return only the safe principal — never the token (it lives in the cookie).
      return result.principal;
    },
  );

  app.post(`${API_BASE_PATH}/auth/logout`, async (request, reply) => {
    const token = readSessionToken(request.headers.cookie);
    await api.logout(token);
    reply.header('set-cookie', buildClearSessionCookie(config.secureCookies));
    return { ok: true };
  });
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  config: AuthRoutesConfig,
): void {
  reply.header(
    'set-cookie',
    buildSessionCookie(token, {
      secure: config.secureCookies,
      maxAgeSeconds: config.sessionTtlSeconds,
    }),
  );
}
