/**
 * Local-account authentication service (Phase 8, tasks 8.1).
 *
 * The vendor-neutral business layer behind the auth endpoints (design.md §5a/§6):
 *   POST /api/v1/auth/register  — self-register (stored PENDING)
 *   POST /api/v1/auth/login     — verify credentials, issue an opaque session
 *   POST /api/v1/auth/logout    — revoke the current session
 *
 * Security (requirements.md R1): passwords are hashed with Argon2id and never
 * stored/logged in plaintext; sessions are random opaque tokens stored by their
 * hash; registration and login are rate-limited; registration, login failure
 * and logout are recorded as audit events that never contain a password, token
 * or user-authored status content.
 *
 * This depends only on the narrow identity ports + small interfaces
 * (PasswordHasher, RateLimiter), so a future OIDC provider can replace it
 * without touching business services.
 */
import { randomUUID } from 'node:crypto';
import type { LoginInput, PublicUser, RegisterInput, UserAccount } from '../domain/accounts.js';
import { toPublicUser } from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import type { CurrentUser } from '../domain/identity.js';
import { ApiError, type FieldError } from '../http/errorEnvelope.js';
import type { IdentityRepository } from '../repository/identityRepository.js';
import { DuplicateKeyError } from '../repository/errors.js';
import type { PasswordHasher } from '../auth/passwordHasher.js';
import { buildPrincipal } from '../auth/principal.js';
import type { RateLimiter } from '../auth/rateLimiter.js';
import { generateSessionToken, hashSessionToken } from '../auth/session.js';

/** Append-only audit sink (subset of DocumentRepository / IdentityRepository). */
export interface AuditPort {
  appendAudit(event: AuditEvent): Promise<AuditEvent>;
}

/** Programme id used for account/auth audit events not tied to a programme. */
const SYSTEM_PROGRAMME = 'system';

export interface AuthServiceDeps {
  /** The identity repository (reads + atomic identity write workflows). */
  identity: IdentityRepository;
  hasher: PasswordHasher;
  registerLimiter: RateLimiter;
  loginLimiter: RateLimiter;
  sessionTtlMs: number;
  now?: () => number;
}

/** A successful login: the principal plus the raw session token for the cookie. */
export interface LoginResult {
  principal: CurrentUser;
  token: string;
  expiresAt: string;
}

/** Public API consumed by the auth routes. */
export interface AuthApi {
  register(input: RegisterInput, clientKey: string): Promise<PublicUser>;
  login(input: LoginInput, clientKey: string): Promise<LoginResult>;
  logout(token: string | undefined): Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

export class AuthService implements AuthApi {
  private readonly deps: AuthServiceDeps;
  private readonly now: () => number;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  async register(input: RegisterInput, clientKey: string): Promise<PublicUser> {
    // R1.9 — rate-limit registration by client key (IP).
    this.enforceRateLimit(this.deps.registerLimiter, `register:${clientKey}`);

    const email = normaliseEmail(input.email);
    const displayName = (input.displayName ?? '').trim();
    const password = input.password ?? '';
    const requestedTeam = (input.requestedTeam ?? '').trim();

    const errors: FieldError[] = [];
    if (displayName.length === 0 || displayName.length > 100) {
      errors.push({ path: 'displayName', message: 'Enter a display name (1–100 characters).' });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      errors.push({ path: 'email', message: 'Enter a valid email address.' });
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      errors.push({
        path: 'password',
        message: `Use a password of ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`,
      });
    }
    if (requestedTeam.length > 200) {
      errors.push({ path: 'requestedTeam', message: 'Requested team is too long.' });
    }
    if (errors.length > 0) {
      throw ApiError.validation('Check the highlighted fields and try again.', errors);
    }

    // One account per email (R1a). Pre-check for a friendly error; the unique
    // index is the race-safe backstop below.
    const existing = await this.deps.identity.getUserByEmail(email);
    if (existing) {
      throw new ApiError('EMAIL_TAKEN', 'An account with this email already exists.');
    }

    const passwordHash = await this.deps.hasher.hash(password);
    const timestamp = new Date(this.now()).toISOString();
    const user: UserAccount = {
      id: randomUUID(),
      email,
      displayName,
      passwordHash,
      status: 'PENDING',
      ...(requestedTeam ? { requestedTeam } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // R1.10 / atomicity — create the user and its USER_REGISTERED audit in ONE
    // atomic operation, so a failure never leaves a user without its audit
    // record (or vice versa). The audit stores only stable ids/action — never
    // the password (nor its hash) or the requested-team free text.
    try {
      await this.deps.identity.createUserWithAudit({
        user,
        audit: this.auditEvent('USER_REGISTERED', user.id, user.id, timestamp),
      });
    } catch (error) {
      if (error instanceof DuplicateKeyError) {
        throw new ApiError('EMAIL_TAKEN', 'An account with this email already exists.');
      }
      throw error;
    }

    return toPublicUser(user, null);
  }

  async login(input: LoginInput, clientKey: string): Promise<LoginResult> {
    const email = normaliseEmail(input.email);
    const password = input.password ?? '';

    // R1.9 — rate-limit login by client key + email.
    this.enforceRateLimit(this.deps.loginLimiter, `login:${clientKey}:${email}`);

    const user = await this.deps.identity.getUserByEmail(email);
    // Verify against the stored hash. When the user is unknown we still burn a
    // verify against a throwaway hash so timing does not reveal which emails
    // exist. A failure is a generic 401 that does not disclose which of email
    // or password was wrong.
    const ok = user
      ? await this.deps.hasher.verify(user.passwordHash, password)
      : await this.dummyVerify(password);

    if (!user || !ok) {
      await this.appendAudit(
        'LOGIN_FAILED',
        user?.id ?? 'unknown',
        user?.id ?? 'unknown',
        new Date(this.now()).toISOString(),
        'INVALID_CREDENTIALS',
      );
      throw new ApiError('AUTH_FAILED', 'Email or password is incorrect.');
    }

    // Rejected / suspended accounts cannot sign in (R1.4). Record the denial.
    if (user.status === 'REJECTED' || user.status === 'SUSPENDED') {
      await this.appendAudit(
        'LOGIN_FAILED',
        user.id,
        user.id,
        new Date(this.now()).toISOString(),
        'ACCOUNT_INACTIVE',
      );
      throw new ApiError(
        'ACCOUNT_INACTIVE',
        'This account is not active. Contact an administrator.',
      );
    }

    // PENDING and ACTIVE may sign in. PENDING gets a session so the UI can show
    // the pending-approval screen via GET /me; the ACTIVE gate still blocks it
    // from programme data.
    const token = generateSessionToken();
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt + this.deps.sessionTtlMs).toISOString();
    await this.deps.identity.createSession({
      id: hashSessionToken(token),
      userId: user.id,
      createdAt: new Date(issuedAt).toISOString(),
      expiresAt,
    });

    // A successful login clears its own rate-limit bucket.
    this.deps.loginLimiter.reset(`login:${clientKey}:${email}`);

    const assignment = await this.deps.identity.getAssignment(user.id);
    return { principal: buildPrincipal(user, assignment), token, expiresAt };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const sessionId = hashSessionToken(token);
    const session = await this.deps.identity.getSession(sessionId);
    await this.deps.identity.deleteSession(sessionId);
    if (session) {
      await this.appendAudit(
        'LOGOUT',
        session.userId,
        session.userId,
        new Date(this.now()).toISOString(),
      );
    }
  }

  /** Enforce a rate-limit bucket, throwing RATE_LIMITED when exceeded. */
  private enforceRateLimit(limiter: RateLimiter, key: string): void {
    const result = limiter.hit(key);
    if (!result.allowed) {
      throw new ApiError('RATE_LIMITED', 'Too many attempts. Please wait and try again.');
    }
  }

  /** Burn a hash verify with a fixed dummy hash to normalise timing. */
  private async dummyVerify(password: string): Promise<boolean> {
    // A syntactically valid Argon2id hash of a random value; verify always fails.
    const DUMMY =
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000';
    await this.deps.hasher.verify(DUMMY, password).catch(() => false);
    return false;
  }

  /** Build an account/auth audit event (no password, token or free text). */
  private auditEvent(
    action: AuditEvent['action'],
    actorSubject: string,
    entityId: string,
    timestamp: string,
    reason?: string,
  ): AuditEvent {
    return {
      id: randomUUID(),
      programmeId: SYSTEM_PROGRAMME,
      aggregateId: entityId,
      entityType: 'USER',
      entityId,
      action,
      actorSubject,
      timestamp,
      ...(reason ? { reason } : {}),
      correlationId: randomUUID(),
    };
  }

  /** Append a single account/auth audit event (login failure, logout). */
  private async appendAudit(
    action: AuditEvent['action'],
    actorSubject: string,
    entityId: string,
    timestamp: string,
    reason?: string,
  ): Promise<void> {
    await this.deps.identity.appendAudit(
      this.auditEvent(action, actorSubject, entityId, timestamp, reason),
    );
  }
}

/** Lowercase + trim an email for storage and lookup. */
function normaliseEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}
