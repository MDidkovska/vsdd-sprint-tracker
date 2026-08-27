/**
 * Session token + cookie helpers (Phase 8, design.md §5a).
 *
 * A session token is 256 bits of CSPRNG randomness, base64url-encoded. It is
 * sent ONLY in an HttpOnly, SameSite cookie and is NEVER stored or logged: the
 * `sessions` document is keyed by the SHA-256 hash of the token, so a database
 * disclosure never yields a usable session.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** The session cookie name. */
export const SESSION_COOKIE = 'vsdd_session';

/** Generate a new opaque session token (base64url, 256 bits of entropy). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a session token for storage/lookup (never store the raw token). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison of two hex hashes (defensive; lookups are by key). */
export function safeHashEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface CookieOptions {
  secure: boolean;
  /** Max-Age in seconds. Omit for a session cookie. */
  maxAgeSeconds?: number;
}

/**
 * Build a `Set-Cookie` header value carrying the session token. HttpOnly (no JS
 * access — tokens never touch localStorage), SameSite=Lax (CSRF mitigation),
 * Path=/, and Secure outside local development (R1.3).
 */
export function buildSessionCookie(token: string, options: CookieOptions): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
  ];
  if (options.secure) parts.push('Secure');
  if (typeof options.maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  return parts.join('; ');
}

/** Build the `Set-Cookie` header value that clears the session cookie. */
export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Extract the session token from a raw `Cookie` request header, if present. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    if (name === SESSION_COOKIE) {
      const value = pair.slice(index + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}
