/**
 * CSRF protection for state-changing requests (task 10.1, design.md §13).
 *
 * Session cookies are already `SameSite=Lax`, which blocks the classic
 * cross-site form POST. On top of that baseline this adds an explicit
 * double-submit-cookie token so a state-changing request must prove it was
 * issued by our own first-party app code:
 *
 *  - A non-HttpOnly `vsdd_csrf` cookie carries a random token. It is readable by
 *    our SPA (unlike the session cookie) precisely so the app can echo it back.
 *  - Every state-changing request (POST/PUT/PATCH/DELETE) to the API must send
 *    that same token in the `X-CSRF-Token` header. A cross-site attacker can
 *    ride the session cookie but cannot read the token cookie (same-origin
 *    policy) to forge the header, so the request is rejected.
 *
 * Public bootstrap routes (register/login) are exempt: they run before any
 * session exists and are protected by rate limiting and generic responses
 * (task 10.3). The token cookie is seeded on the first request that lacks one
 * (e.g. the SPA's initial `GET /me`), so it is present by the time the user
 * performs any authenticated write. Secure is gated exactly like the session
 * cookie so plain-HTTP local development keeps working (R1.3).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errorEnvelope.js';

/** The double-submit CSRF cookie name (readable by first-party JS). */
export const CSRF_COOKIE = 'vsdd_csrf';

/** The header the client echoes the cookie token back in. */
export const CSRF_HEADER = 'x-csrf-token';

/** HTTP methods that mutate state and therefore require a CSRF token. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CsrfConfig {
  /** Mark the CSRF cookie `Secure` (outside local development). */
  secureCookies: boolean;
}

/** Generate a new CSRF token (128 bits of CSPRNG randomness, base64url). */
export function generateCsrfToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Build the `Set-Cookie` value seeding the CSRF token. NOT HttpOnly — the SPA
 * must read it to echo it back — but still `SameSite=Lax`, `Path=/` and `Secure`
 * outside local development.
 */
export function buildCsrfCookie(token: string, config: CsrfConfig): string {
  const parts = [`${CSRF_COOKIE}=${token}`, 'SameSite=Lax', 'Path=/'];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

/** Extract the CSRF token from a raw `Cookie` request header, if present. */
export function readCsrfCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    if (name === CSRF_COOKIE) {
      const value = pair.slice(index + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/** Read the echoed CSRF token from the request headers, if present. */
export function readCsrfHeader(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers[CSRF_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/** Constant-time comparison of two token strings. */
export function csrfTokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Strip the query string from a raw request url. */
function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Whether a request must carry a valid CSRF token: a state-changing method to an
 * API route, excluding the public register/login bootstrap (no session yet).
 */
export function requiresCsrf(method: string, url: string): boolean {
  if (!STATE_CHANGING_METHODS.has(method.toUpperCase())) return false;
  const path = pathOf(url);
  if (!path.startsWith('/api/v1/')) return false;
  if (path === '/api/v1/auth/register' || path === '/api/v1/auth/login') return false;
  return true;
}

/**
 * Register the CSRF protection hook. Seeds the token cookie when the client does
 * not yet have one, and rejects any state-changing request whose `X-CSRF-Token`
 * header does not match the token cookie (PERMISSION_DENIED / 403). Register this
 * BEFORE the authentication hook so a forged write is rejected before any
 * session lookup.
 */
export function registerCsrfProtection(app: FastifyInstance, config: CsrfConfig): void {
  app.addHook('onRequest', (request, reply, done) => {
    const cookieToken = readCsrfCookie(request.headers.cookie);

    // Seed a token for clients that do not have one yet (e.g. the initial page
    // load / GET /me), so it is available before any authenticated write.
    if (!cookieToken) {
      reply.header('set-cookie', buildCsrfCookie(generateCsrfToken(), config));
    }

    if (requiresCsrf(request.method, request.url)) {
      const headerToken = readCsrfHeader(request.headers);
      if (!cookieToken || !headerToken || !csrfTokensMatch(cookieToken, headerToken)) {
        done(
          new ApiError(
            'PERMISSION_DENIED',
            'This request is missing a valid security token. Refresh the page and try again.',
          ),
        );
        return;
      }
    }

    done();
  });
}
