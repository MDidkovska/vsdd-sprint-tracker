/**
 * CSRF double-submit helper unit tests (task 10.1).
 *
 * Prove the pure helpers behave correctly: token generation, cookie/header
 * parsing, constant-time matching, Secure gating and the state-changing route
 * classification (public register/login exempt).
 */
import { describe, expect, it } from 'vitest';
import {
  buildCsrfCookie,
  csrfTokensMatch,
  generateCsrfToken,
  readCsrfCookie,
  readCsrfHeader,
  requiresCsrf,
} from './csrf.js';

describe('csrf helpers', () => {
  it('generates unique, non-empty base64url tokens', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(10);
  });

  it('builds a readable (non-HttpOnly) SameSite cookie, Secure gated', () => {
    const insecure = buildCsrfCookie('tok', { secureCookies: false });
    expect(insecure).toContain('vsdd_csrf=tok');
    expect(insecure).toContain('SameSite=Lax');
    expect(insecure).toContain('Path=/');
    expect(insecure).not.toContain('HttpOnly');
    expect(insecure).not.toContain('Secure');

    const secure = buildCsrfCookie('tok', { secureCookies: true });
    expect(secure).toContain('Secure');
  });

  it('reads the CSRF token from a cookie header (or undefined)', () => {
    expect(readCsrfCookie('vsdd_session=abc; vsdd_csrf=xyz')).toBe('xyz');
    expect(readCsrfCookie('vsdd_csrf=')).toBeUndefined();
    expect(readCsrfCookie(undefined)).toBeUndefined();
    expect(readCsrfCookie('other=1')).toBeUndefined();
  });

  it('reads the CSRF header (string or array) or undefined', () => {
    expect(readCsrfHeader({ 'x-csrf-token': 'xyz' })).toBe('xyz');
    expect(readCsrfHeader({ 'x-csrf-token': ['xyz', 'zzz'] })).toBe('xyz');
    expect(readCsrfHeader({})).toBeUndefined();
    expect(readCsrfHeader({ 'x-csrf-token': '' })).toBeUndefined();
  });

  it('matches tokens in constant time only when equal', () => {
    expect(csrfTokensMatch('same-token', 'same-token')).toBe(true);
    expect(csrfTokensMatch('a', 'b')).toBe(false);
    expect(csrfTokensMatch('short', 'longer-token')).toBe(false);
  });

  it('requires CSRF only for state-changing API routes, excluding register/login', () => {
    expect(requiresCsrf('POST', '/api/v1/auth/logout')).toBe(true);
    expect(requiresCsrf('PUT', '/api/v1/admin/users/u1/assignments')).toBe(true);
    expect(requiresCsrf('POST', '/api/v1/notifications/read-all')).toBe(true);
    expect(requiresCsrf('DELETE', '/api/v1/teams/t/drafts/c')).toBe(true);

    // Safe methods never require it.
    expect(requiresCsrf('GET', '/api/v1/me')).toBe(false);
    expect(requiresCsrf('HEAD', '/api/v1/programmes/vsdd/hierarchy')).toBe(false);

    // Public bootstrap routes are exempt (no session yet).
    expect(requiresCsrf('POST', '/api/v1/auth/register')).toBe(false);
    expect(requiresCsrf('POST', '/api/v1/auth/login')).toBe(false);

    // Non-API routes (health/ready) are out of scope.
    expect(requiresCsrf('POST', '/health')).toBe(false);
  });
});
