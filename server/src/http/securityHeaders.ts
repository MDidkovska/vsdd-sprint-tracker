/**
 * Minimal security response headers for the local PoC (task 10.1, design.md §13).
 *
 * The Fastify backend serves the JSON API; the SPA is served separately by Vite
 * (dev) or a static host (build). These headers therefore harden the API origin
 * without touching the Vite dev server — the CSP applies to responses this
 * server produces, so it can stay strict without breaking local HMR.
 *
 * The policy is intentionally small and forward-compatible: if the backend ever
 * serves the built SPA, `script-src 'self'` / `style-src 'self'` already match a
 * Vite production build (external module scripts, hashed assets). It is
 * local-HTTP friendly — nothing here requires HTTPS — so plain-HTTP development
 * keeps working (requirements.md §6, R1.3).
 */
import type { FastifyInstance } from 'fastify';

/**
 * A minimal Content-Security-Policy. `default-src 'self'` is the baseline;
 * `object-src`/`base-uri`/`frame-ancestors` lock down the classic injection and
 * clickjacking vectors; inline styles are allowed (React/tooling emit a few)
 * while inline scripts are not. No remote origins are allow-listed — the API and
 * the app share an origin behind the dev proxy.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Register the security-header hook. Applies a minimal CSP plus the standard
 * companion headers (nosniff, frame denial, a lean referrer policy) to every
 * response. Registered unconditionally — the headers are additive and never
 * depend on HTTPS, so they are safe for plain-HTTP local development.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', (_request, reply, done) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    done();
  });
}
