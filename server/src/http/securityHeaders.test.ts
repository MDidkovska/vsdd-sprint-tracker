/**
 * Security-header tests (task 10.1).
 *
 * Prove the server sends a minimal Content-Security-Policy plus the standard
 * companion headers on every response, and that the policy is HTTPS-independent
 * (no `upgrade-insecure-requests` / HSTS) so plain-HTTP local development keeps
 * working.
 */
import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { CONTENT_SECURITY_POLICY } from './securityHeaders.js';

describe('security headers', () => {
  it('sets a minimal CSP and companion headers on responses', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });

  it('keeps the CSP local-HTTP friendly (no forced HTTPS upgrade)', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/health' });

    const csp = res.headers['content-security-policy'] as string;
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });
});
