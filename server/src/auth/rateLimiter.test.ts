/**
 * Fixed-window rate limiter tests (Phase 8, R1.9).
 */
import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  it('allows up to max attempts, then blocks within the window', () => {
    const now = 1_000;
    const limiter = new RateLimiter({ max: 3, windowMs: 1000, now: () => now });

    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(true);
    const blocked = limiter.hit('k');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets after the window elapses', () => {
    let now = 0;
    const limiter = new RateLimiter({ max: 1, windowMs: 500, now: () => now });
    expect(limiter.hit('k').allowed).toBe(true);
    expect(limiter.hit('k').allowed).toBe(false);
    now = 600;
    expect(limiter.hit('k').allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('b').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  it('reset() clears a key so it is allowed again', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
    limiter.reset('a');
    expect(limiter.hit('a').allowed).toBe(true);
  });
});
