/**
 * AuthService unit tests (Phase 8, task 8.1).
 *
 * Cover registration + duplicate email, validation, password hashing, login
 * success/failure/rate-limiting, session creation + logout revocation, and the
 * security invariants: a password hash is never returned, and no password or
 * session token is written into an audit event.
 */
import { describe, expect, it } from 'vitest';
import { Argon2idHasher, type PasswordHasher } from '../auth/passwordHasher.js';
import { RateLimiter } from '../auth/rateLimiter.js';
import { hashSessionToken } from '../auth/session.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { ApiError } from '../http/errorEnvelope.js';
import { AuthService, type AuthServiceDeps } from './authService.js';

/** A fast, deterministic hasher for the bulk of the suite. */
const fakeHasher: PasswordHasher = {
  hash: async (p) => `hashed:${p}`,
  verify: async (h, p) => h === `hashed:${p}`,
};

function build(overrides: Partial<AuthServiceDeps> = {}): {
  service: AuthService;
  repo: InMemoryIdentityRepository;
} {
  const repo = new InMemoryIdentityRepository();
  const service = new AuthService({
    identity: repo,
    hasher: fakeHasher,
    registerLimiter: new RateLimiter({ max: 100, windowMs: 60_000 }),
    loginLimiter: new RateLimiter({ max: 100, windowMs: 60_000 }),
    sessionTtlMs: 60 * 60 * 1000,
    ...overrides,
  });
  return { service, repo };
}

const REGISTER = {
  displayName: 'Dana Example',
  email: 'Dana@Example.com',
  password: 'a-good-password',
  requestedTeam: 'PTSB-VSDD MMM A',
};

describe('AuthService.register', () => {
  it('creates a PENDING user and never returns a password hash', async () => {
    const { service, repo } = build();
    const user = await service.register(REGISTER, '127.0.0.1');

    expect(user.status).toBe('PENDING');
    expect(user.email).toBe('dana@example.com'); // normalised
    expect(user.roles).toEqual([]);
    expect(JSON.stringify(user)).not.toContain('password');
    expect(JSON.stringify(user)).not.toContain('hash');

    const stored = await repo.getUserByEmail('dana@example.com');
    expect(stored?.passwordHash).toBe('hashed:a-good-password');
    // Audit records the registration but never the password.
    const registered = repo.auditEvents.find((e) => e.action === 'USER_REGISTERED');
    expect(registered).toBeDefined();
    expect(JSON.stringify(repo.auditEvents)).not.toContain('a-good-password');
  });

  it('rejects a duplicate email', async () => {
    const { service } = build();
    await service.register(REGISTER, '127.0.0.1');
    await expect(service.register(REGISTER, '127.0.0.1')).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  it('validates display name, email and password', async () => {
    const { service } = build();
    await expect(
      service.register({ displayName: '', email: 'bad', password: 'short' }, '127.0.0.1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rate-limits registration by client key', async () => {
    const { service } = build({
      registerLimiter: new RateLimiter({ max: 1, windowMs: 60_000 }),
    });
    await service.register(REGISTER, '10.0.0.1');
    await expect(
      service.register({ ...REGISTER, email: 'other@example.com' }, '10.0.0.1'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('stores a real Argon2id hash (not the plaintext) when using the real hasher', async () => {
    const { service, repo } = build({ hasher: new Argon2idHasher() });
    await service.register(REGISTER, '127.0.0.1');
    const stored = await repo.getUserByEmail('dana@example.com');
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored?.passwordHash).not.toContain('a-good-password');
  });
});

describe('AuthService.login', () => {
  async function withUser(status: 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED') {
    const { service, repo } = build();
    await service.register(REGISTER, '127.0.0.1');
    if (status !== 'PENDING') {
      const user = await repo.getUserByEmail('dana@example.com');
      await repo.updateUserStatus(user!.id, status, new Date().toISOString());
    }
    return { service, repo };
  }

  it('issues a session for a PENDING account and returns the principal (no token in principal)', async () => {
    const { service, repo } = await withUser('PENDING');
    const result = await service.login({ email: 'dana@example.com', password: 'a-good-password' }, 'ip');
    expect(result.principal.status).toBe('PENDING');
    expect(result.token).toBeTruthy();
    // The stored session is keyed by the token HASH, never the raw token.
    expect(await repo.getSession(hashSessionToken(result.token))).not.toBeNull();
    expect(JSON.stringify(result.principal)).not.toContain(result.token);
  });

  it('issues a session for an ACTIVE account', async () => {
    const { service } = await withUser('ACTIVE');
    const result = await service.login({ email: 'dana@example.com', password: 'a-good-password' }, 'ip');
    expect(result.principal.status).toBe('ACTIVE');
  });

  it('rejects a wrong password with a generic AUTH_FAILED and audits the failure', async () => {
    const { service, repo } = await withUser('ACTIVE');
    await expect(
      service.login({ email: 'dana@example.com', password: 'wrong' }, 'ip'),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(repo.auditEvents.some((e) => e.action === 'LOGIN_FAILED')).toBe(true);
    // The attempted password is never stored in the audit trail.
    expect(JSON.stringify(repo.auditEvents)).not.toContain('wrong');
  });

  it('rejects an unknown email with AUTH_FAILED (no user enumeration)', async () => {
    const { service } = build();
    await expect(
      service.login({ email: 'nobody@example.com', password: 'whatever-here' }, 'ip'),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('refuses a REJECTED account with ACCOUNT_INACTIVE', async () => {
    const { service } = await withUser('REJECTED');
    await expect(
      service.login({ email: 'dana@example.com', password: 'a-good-password' }, 'ip'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });

  it('refuses a SUSPENDED account with ACCOUNT_INACTIVE', async () => {
    const { service } = await withUser('SUSPENDED');
    await expect(
      service.login({ email: 'dana@example.com', password: 'a-good-password' }, 'ip'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });

  it('rate-limits repeated login attempts', async () => {
    const { service } = build({
      loginLimiter: new RateLimiter({ max: 2, windowMs: 60_000 }),
    });
    await service.register(REGISTER, '127.0.0.1');
    const attempt = () =>
      service.login({ email: 'dana@example.com', password: 'wrong' }, 'shared-ip');
    await expect(attempt()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(attempt()).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    await expect(attempt()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('AuthService.logout', () => {
  it('revokes the session and audits the logout', async () => {
    const { service, repo } = build();
    await service.register(REGISTER, '127.0.0.1');
    const user = await repo.getUserByEmail('dana@example.com');
    await repo.updateUserStatus(user!.id, 'ACTIVE', new Date().toISOString());
    const { token } = await service.login({ email: 'dana@example.com', password: 'a-good-password' }, 'ip');

    await service.logout(token);
    expect(await repo.getSession(hashSessionToken(token))).toBeNull();
    expect(repo.auditEvents.some((e) => e.action === 'LOGOUT')).toBe(true);
    // No session token is ever written to the audit trail.
    expect(JSON.stringify(repo.auditEvents)).not.toContain(token);
  });

  it('is a no-op for a missing token', async () => {
    const { service } = build();
    await expect(service.logout(undefined)).resolves.toBeUndefined();
  });
});

// A guard so an accidental unhandled ApiError type change is caught.
it('AuthService errors are ApiError instances', async () => {
  const { service } = build();
  await service.register(REGISTER, '127.0.0.1');
  await service.register(REGISTER, '127.0.0.1').catch((e) => {
    expect(e).toBeInstanceOf(ApiError);
  });
});
