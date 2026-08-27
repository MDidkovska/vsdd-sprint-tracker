/**
 * Fixed-window rate limiter (Phase 8, requirements.md R1.9).
 *
 * Registration and login are rate-limited to blunt credential-stuffing and
 * registration-spam. This is a small, dependency-free in-memory limiter keyed by
 * an arbitrary string (e.g. client IP, or IP + email). The clock is injectable
 * so the behaviour is deterministic under test.
 *
 * For the local PoC an in-process counter is sufficient. A production
 * deployment behind multiple instances would swap this for a shared store; the
 * {@link RateLimiter} shape stays the same.
 */
export interface RateLimiterOptions {
  /** Maximum attempts allowed within the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock (defaults to Date.now) for deterministic tests. */
  now?: () => number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the window resets (only meaningful when blocked). */
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, WindowState>();

  constructor(options: RateLimiterOptions) {
    this.max = options.max;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  /**
   * Record an attempt for `key` and report whether it is allowed. The first
   * `max` attempts inside a window are allowed; further attempts are blocked
   * until the window resets.
   */
  hit(key: string): RateLimitResult {
    const current = this.now();
    const existing = this.windows.get(key);

    if (!existing || current >= existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: current + this.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (existing.count >= this.max) {
      return { allowed: false, retryAfterMs: Math.max(0, existing.resetAt - current) };
    }

    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Reset the counter for a key (e.g. after a successful login). */
  reset(key: string): void {
    this.windows.delete(key);
  }
}
