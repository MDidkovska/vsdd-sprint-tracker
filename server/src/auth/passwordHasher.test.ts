/**
 * Argon2id password hasher tests (Phase 8, R1.2).
 *
 * Proves the hasher uses Argon2id, never returns the plaintext, and verifies
 * correctly for matching and non-matching passwords.
 */
import { describe, expect, it } from 'vitest';
import { Argon2idHasher } from './passwordHasher.js';

describe('Argon2idHasher', () => {
  const hasher = new Argon2idHasher();

  it('produces an Argon2id hash that is not the plaintext', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('verifies a matching password', async () => {
    const hash = await hasher.hash('s3cret-passphrase');
    expect(await hasher.verify(hash, 's3cret-passphrase')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hasher.hash('s3cret-passphrase');
    expect(await hasher.verify(hash, 'wrong-password')).toBe(false);
  });

  it('returns false (never throws) for a malformed stored hash', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
  });

  it('produces distinct hashes for the same password (random salt)', async () => {
    const a = await hasher.hash('same-password-here');
    const b = await hasher.hash('same-password-here');
    expect(a).not.toBe(b);
  });
});
