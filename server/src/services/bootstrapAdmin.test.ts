/**
 * bootstrapAdmin tests (Phase 8, task 8.7).
 *
 * The first-admin bootstrap creates one ACTIVE admin with an ADMIN assignment,
 * hashes the password (never stores plaintext) and is idempotent — re-running
 * makes no change.
 */
import { describe, expect, it } from 'vitest';
import { Argon2idHasher, type PasswordHasher } from '../auth/passwordHasher.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';

const fakeHasher: PasswordHasher = {
  hash: async (p) => `hashed:${p}`,
  verify: async (h, p) => h === `hashed:${p}`,
};

const INPUT = {
  email: 'Admin@Example.com',
  displayName: 'First Admin',
  password: 'bootstrap-password',
  programmeId: 'vsdd',
};

describe('bootstrapAdmin', () => {
  it('creates an ACTIVE admin with an ADMIN assignment', async () => {
    const repo = new InMemoryIdentityRepository();
    const result = await bootstrapAdmin(
      { identity: repo, hasher: fakeHasher },
      INPUT,
    );
    expect(result.created).toBe(true);

    const user = await repo.getUserByEmail('admin@example.com');
    expect(user?.status).toBe('ACTIVE');
    expect(user?.passwordHash).toBe('hashed:bootstrap-password');
    const assignment = await repo.getAssignment(user!.id);
    expect(assignment?.roles).toEqual(['ADMIN']);
  });

  it('is idempotent — a second run makes no change', async () => {
    const repo = new InMemoryIdentityRepository();
    const first = await bootstrapAdmin({ identity: repo, hasher: fakeHasher }, INPUT);
    const second = await bootstrapAdmin({ identity: repo, hasher: fakeHasher }, INPUT);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect((await repo.listUsers()).length).toBe(1);
  });

  it('validates the password length', async () => {
    const repo = new InMemoryIdentityRepository();
    await expect(
      bootstrapAdmin({ identity: repo, hasher: fakeHasher }, { ...INPUT, password: 'short' }),
    ).rejects.toThrow();
  });

  it('stores a real Argon2id hash', async () => {
    const repo = new InMemoryIdentityRepository();
    await bootstrapAdmin({ identity: repo, hasher: new Argon2idHasher() }, INPUT);
    const user = await repo.getUserByEmail('admin@example.com');
    expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });
});
