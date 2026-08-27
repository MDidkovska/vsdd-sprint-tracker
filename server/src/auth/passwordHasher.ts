/**
 * Password hashing seam (Phase 8, design.md §5a).
 *
 * Passwords are hashed with **Argon2id** (requirements.md R1.2). This is a small
 * replaceable interface: once a future enterprise OIDC provider owns
 * authentication, local passwords disappear and this seam simply goes unused —
 * no business service depends on it.
 *
 * Plaintext passwords are never stored or logged; only the returned hash is
 * persisted, and it is never exposed through an API response.
 */
import { Algorithm, hash, verify } from '@node-rs/argon2';

export interface PasswordHasher {
  /** Hash a plaintext password with Argon2id. */
  hash(password: string): Promise<string>;
  /** Verify a plaintext password against a stored Argon2id hash. */
  verify(storedHash: string, password: string): Promise<boolean>;
}

/**
 * Argon2id password hasher. Uses OWASP-aligned defaults (19 MiB memory, 2
 * iterations, parallelism 1) which the underlying library applies; the
 * algorithm is pinned to Argon2id explicitly so the choice is unambiguous.
 */
export class Argon2idHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return hash(password, { algorithm: Algorithm.Argon2id });
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password, { algorithm: Algorithm.Argon2id });
    } catch {
      // A malformed/unknown hash must never authenticate — treat as a mismatch.
      return false;
    }
  }
}
