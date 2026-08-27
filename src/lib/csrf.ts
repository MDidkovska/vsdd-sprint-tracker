/**
 * Frontend CSRF double-submit helper (task 10.1, design.md §13).
 *
 * The backend seeds a readable `vsdd_csrf` cookie (unlike the HttpOnly session
 * cookie). For every state-changing request our API clients echo that token
 * back in the `X-CSRF-Token` header, proving the request originated from our
 * own first-party app code rather than a cross-site forgery.
 *
 * The token is a CSRF nonce, not a credential: reading it from `document.cookie`
 * is intentional and safe (the session token never leaves its HttpOnly cookie).
 */

/** The readable CSRF cookie name (mirrors the backend). */
export const CSRF_COOKIE = 'vsdd_csrf';

/** The header the token is echoed back in (mirrors the backend). */
export const CSRF_HEADER = 'X-CSRF-Token';

/** HTTP methods that mutate state and therefore need the CSRF token. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Read the CSRF token from `document.cookie`, or undefined when absent. */
export function readCsrfToken(): string | undefined {
  if (typeof document === 'undefined' || !document.cookie) return undefined;
  for (const pair of document.cookie.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    if (name === CSRF_COOKIE) {
      const value = decodeURIComponent(pair.slice(index + 1).trim());
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Return the CSRF header for a state-changing request, or an empty object for a
 * safe method / when no token is available yet. Merge this into a fetch
 * `headers` object.
 */
export function csrfHeaders(method: string | undefined): Record<string, string> {
  const verb = (method ?? 'GET').toUpperCase();
  if (!STATE_CHANGING_METHODS.has(verb)) return {};
  const token = readCsrfToken();
  return token ? { [CSRF_HEADER]: token } : {};
}
