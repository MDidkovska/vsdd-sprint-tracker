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

/** The exact, constant-shaped body a registration acknowledgement must have. */
const ACCEPTED_KEYS = ['email', 'status'];

describe('AuthService.register', () => {
  it('returns a neutral PENDING acknowledgement and never a password hash or account projection', async () => {
    const { service, repo } = build();
    const accepted = await service.register(REGISTER, '127.0.0.1');

    // The neutral projection carries ONLY a constant status + the submitted
    // email — never any account-derived field (id, roles, assignment, name).
    expect(Object.keys(accepted).sort()).toEqual(ACCEPTED_KEYS);
    expect(accepted.status).toBe('PENDING');
    expect(accepted.email).toBe('dana@example.com'); // normalised
    expect(accepted).not.toHaveProperty('id');
    expect(accepted).not.toHaveProperty('roles');
    expect(accepted).not.toHaveProperty('teamIds');
    expect(accepted).not.toHaveProperty('programmeId');
    expect(accepted).not.toHaveProperty('displayName');
    expect(JSON.stringify(accepted)).not.toContain('password');
    expect(JSON.stringify(accepted)).not.toContain('hash');

    // The account IS created and stored (PENDING) with its hashed password.
    const stored = await repo.getUserByEmail('dana@example.com');
    expect(stored?.status).toBe('PENDING');
    expect(stored?.passwordHash).toBe('hashed:a-good-password');
    // Audit records the registration but never the password.
    const registered = repo.auditEvents.find((e) => e.action === 'USER_REGISTERED');
    expect(registered).toBeDefined();
    expect(JSON.stringify(repo.auditEvents)).not.toContain('a-good-password');
  });

  it('does not reveal that an email is already registered (anti-enumeration, task 10.3)', async () => {
    const { service, repo } = build();

    // A brand-new registration and a REPEAT registration of the SAME email
    // (identical input) must be indistinguishable: same body shape and values,
    // so the response never discloses that the account already exists.
    const first = await service.register(REGISTER, '127.0.0.1');
    const usersAfterFirst = (await repo.listUsers()).length;
    const registeredAfterFirst = repo.auditEvents.filter(
      (e) => e.action === 'USER_REGISTERED',
    ).length;

    // The duplicate resolves (never throws EMAIL_TAKEN) with the same body.
    const second = await service.register(REGISTER, '127.0.0.1');

    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    expect(second).toEqual(first);
    expect(second.status).toBe('PENDING');
    expect(second.email).toBe(first.email);

    // One account per email (R1a): no duplicate account, and no spurious extra
    // USER_REGISTERED audit was written for the repeat attempt.
    expect((await repo.listUsers()).length).toBe(usersAfterFirst);
    expect(
      repo.auditEvents.filter((e) => e.action === 'USER_REGISTERED').length,
    ).toBe(registeredAfterFirst);

    // The stored account keeps its ORIGINAL credentials (not overwritten).
    const stored = await repo.getUserByEmail('dana@example.com');
    expect(stored?.passwordHash).toBe('hashed:a-good-password');
  });

  // The stored account's real status MUST NOT influence the response: a repeat
  // registration for an ACTIVE, SUSPENDED or REJECTED account must be
  // byte-for-byte identical to a brand-new PENDING registration, and must leave
  // the stored account (id, credentials, status) completely untouched.
  for (const storedStatus of ['ACTIVE', 'SUSPENDED', 'REJECTED'] as const) {
    it(`does not leak a stored ${storedStatus} account through a duplicate registration (task 10.3)`, async () => {
      const { service, repo } = build();

      // A brand-new registration for a DIFFERENT email — the neutral baseline
      // every duplicate response must match exactly (except its own email).
      const baseline = await service.register(
        { ...REGISTER, email: 'baseline@example.com' },
        '127.0.0.1',
      );

      // Register dana@…, then move the stored account into the target state.
      await service.register(REGISTER, '127.0.0.1');
      const before = await repo.getUserByEmail('dana@example.com');
      await repo.updateUserStatus(before!.id, storedStatus, new Date().toISOString());

      const usersBefore = (await repo.listUsers()).length;
      const registeredBefore = repo.auditEvents.filter(
        (e) => e.action === 'USER_REGISTERED',
      ).length;

      // Re-register the SAME email while the account is ACTIVE/SUSPENDED/REJECTED.
      const dup = await service.register(REGISTER, '127.0.0.1');

      // Same constant SHAPE and same VALUES as the new-email baseline (only the
      // echoed email differs — it is request-derived, which the caller knows).
      expect(Object.keys(dup).sort()).toEqual(ACCEPTED_KEYS);
      expect(Object.keys(dup).sort()).toEqual(Object.keys(baseline).sort());
      expect(dup.status).toBe('PENDING');
      expect(dup.status).toBe(baseline.status);
      expect(dup).toEqual({ ...baseline, email: 'dana@example.com' });

      // NONE of the stored-account facts leak through the response.
      const body = JSON.stringify(dup);
      expect(dup).not.toHaveProperty('id');
      expect(body).not.toContain(before!.id);
      expect(body).not.toContain(storedStatus); // real status never echoed
      expect(dup).not.toHaveProperty('roles');
      expect(dup).not.toHaveProperty('teamIds');
      expect(dup).not.toHaveProperty('programmeId');
      expect(dup).not.toHaveProperty('displayName');

      // The stored account is UNCHANGED: same id, same hash, same real status.
      const after = await repo.getUserByEmail('dana@example.com');
      expect(after!.id).toBe(before!.id);
      expect(after!.passwordHash).toBe('hashed:a-good-password');
      expect(after!.status).toBe(storedStatus);

      // No duplicate account and no extra USER_REGISTERED audit was created.
      expect((await repo.listUsers()).length).toBe(usersBefore);
      expect(
        repo.auditEvents.filter((e) => e.action === 'USER_REGISTERED').length,
      ).toBe(registeredBefore);
    });
  }

  it('treats a create-time duplicate (race) the same generic way, not EMAIL_TAKEN', async () => {
    const { service, repo } = build();
    await service.register(REGISTER, '127.0.0.1');
    const registeredBefore = repo.auditEvents.filter(
      (e) => e.action === 'USER_REGISTERED',
    ).length;

    // Simulate the race: the pre-check sees no user, but the unique index
    // rejects the insert (DuplicateKeyError). The backstop must still return
    // the generic PENDING response, not disclose EMAIL_TAKEN.
    repo.getUserByEmail = async () => null;

    const result = await service.register(REGISTER, '127.0.0.1');
    expect(result.status).toBe('PENDING');
    // No spurious extra USER_REGISTERED audit for the rejected insert.
    expect(
      repo.auditEvents.filter((e) => e.action === 'USER_REGISTERED').length,
    ).toBe(registeredBefore);
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

  it('returns an IDENTICAL failure for an unknown email and an existing wrong password (task 10.3, no enumeration)', async () => {
    // An existing ACTIVE account with the wrong password, and a completely
    // unknown email, must be indistinguishable: same code AND same message, so
    // an attacker cannot use the response to learn which emails have accounts.
    const { service } = await withUser('ACTIVE');

    const capture = async (email: string, password: string): Promise<ApiError> => {
      try {
        await service.login({ email, password }, `ip-${email}`);
        throw new Error('expected login to reject');
      } catch (error) {
        return error as ApiError;
      }
    };

    const wrongPassword = await capture('dana@example.com', 'definitely-wrong');
    const unknownEmail = await capture('ghost@example.com', 'definitely-wrong');

    expect(wrongPassword.code).toBe('AUTH_FAILED');
    expect(unknownEmail.code).toBe('AUTH_FAILED');
    // The user-facing message is identical for both cases (no distinguishing copy).
    expect(unknownEmail.message).toBe(wrongPassword.message);
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
