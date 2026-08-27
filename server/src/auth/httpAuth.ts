/**
 * HTTP route authentication classification + edge authorisation (Phase 8).
 *
 * The authentication hook uses {@link classifyRoute} to decide whether a request
 * needs a session at all, and {@link authorizeRoute} to apply the coarse,
 * route-level authorisation gates that are not naturally enforced inside a
 * business service (leadership reads and the admin surface). Fine-grained
 * team/role scoping for writes (draft/submit/reopen/decision/export) stays in
 * the services themselves. Everything is default-deny (requirements.md R1.6).
 */
import type { CurrentUser } from '../domain/identity.js';
import { assertAdmin, assertCanReadAudit, assertCanViewProgramme } from './authorization.js';

export type RouteClass = 'public' | 'authed-any' | 'authed-active';

/** Strip the query string from a raw request url. */
function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Classify a route's authentication requirement:
 *  - `public`        — no session (health/readiness, register, login).
 *  - `authed-any`    — any authenticated status (GET /me, logout) so the UI can
 *                      route PENDING/ACTIVE users.
 *  - `authed-active` — a valid session AND an ACTIVE account (all programme data
 *                      and the admin surface).
 */
export function classifyRoute(method: string, url: string): RouteClass {
  const path = pathOf(url);
  const m = method.toUpperCase();

  if (path === '/health' || path === '/ready') return 'public';
  if (m === 'POST' && path === '/api/v1/auth/register') return 'public';
  if (m === 'POST' && path === '/api/v1/auth/login') return 'public';

  if (path === '/api/v1/me') return 'authed-any';
  if (path === '/api/v1/auth/logout') return 'authed-any';

  if (path.startsWith('/api/v1/')) return 'authed-active';

  // Unknown routes are left public so the framework's own 404 is returned
  // rather than a misleading 401.
  return 'public';
}

/**
 * Apply coarse route-level authorisation for an ACTIVE principal. Throws an
 * ApiError (PERMISSION_DENIED) when the principal may not use the route. Applied
 * only to `authed-active` routes, after the ACTIVE-status gate.
 *
 * - `/api/v1/admin/**`                     → Admin only.
 * - `GET /api/v1/audit`                     → Admin/Auditor only.
 * - `GET /api/v1/programmes/:id/reporting-summary` → Leadership/Admin/Auditor.
 *
 * Write endpoints are intentionally not listed here: their team/role scoping is
 * enforced inside the corresponding service.
 */
export function authorizeRoute(
  principal: CurrentUser,
  method: string,
  url: string,
): void {
  const path = pathOf(url);
  const m = method.toUpperCase();

  if (path.startsWith('/api/v1/admin/')) {
    assertAdmin(principal);
    return;
  }

  if (m === 'GET' && path === '/api/v1/audit') {
    assertCanReadAudit(principal);
    return;
  }

  const summaryMatch = /^\/api\/v1\/programmes\/([^/]+)\/reporting-summary$/.exec(path);
  if (m === 'GET' && summaryMatch) {
    assertCanViewProgramme(principal, decodeURIComponent(summaryMatch[1]!));
  }
}
