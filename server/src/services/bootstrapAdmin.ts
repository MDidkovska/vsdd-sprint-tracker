/**
 * First-Admin bootstrap (Phase 8, task 8.7).
 *
 * Creates the very first ACTIVE Admin account so the approval workflow has an
 * administrator to operate it. This is the testable core used by the
 * interactive `npm run bootstrap-admin` command; the CLI wrapper
 * (`scripts/bootstrapAdmin.ts`) collects the password securely (no echo, not in
 * shell history or source control) and calls this.
 *
 * It is IDEMPOTENT: if an account with the email already exists it makes no
 * change and reports `created: false`, so re-running is always safe.
 */
import { randomUUID } from 'node:crypto';
import type { Assignment, UserAccount } from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import type { PasswordHasher } from '../auth/passwordHasher.js';
import type { IdentityRepository } from '../repository/identityRepository.js';
import { DuplicateKeyError } from '../repository/errors.js';

const SYSTEM_PROGRAMME = 'system';

export interface BootstrapAdminInput {
  email: string;
  displayName: string;
  password: string;
  /** Programme the admin is assigned to. */
  programmeId: string;
}

export interface BootstrapAdminDeps {
  identity: IdentityRepository;
  hasher: PasswordHasher;
  now?: () => number;
  idFactory?: () => string;
}

export interface BootstrapAdminResult {
  created: boolean;
  userId: string;
  email: string;
  /** Human-readable reason when nothing was created (idempotent re-run). */
  reason?: string;
}

const MIN_PASSWORD = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapAdmin(
  deps: BootstrapAdminDeps,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const password = input.password ?? '';

  if (!EMAIL_RE.test(email)) {
    throw new Error('A valid email address is required.');
  }
  if (displayName.length === 0) {
    throw new Error('A display name is required.');
  }
  if (password.length < MIN_PASSWORD) {
    throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
  }

  // Idempotency: never create a second account for the same email.
  const existing = await deps.identity.getUserByEmail(email);
  if (existing) {
    return {
      created: false,
      userId: existing.id,
      email,
      reason: 'An account with this email already exists; no change made.',
    };
  }

  const now = deps.now ?? Date.now;
  const id = (deps.idFactory ?? randomUUID)();
  const timestamp = new Date(now()).toISOString();
  const passwordHash = await deps.hasher.hash(password);

  const user: UserAccount = {
    id,
    email,
    displayName,
    passwordHash,
    status: 'ACTIVE',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const assignment: Assignment = {
    id,
    userId: id,
    programmeId: input.programmeId,
    teamIds: [],
    roles: ['ADMIN'],
    updatedAt: timestamp,
  };
  const audit: AuditEvent = {
    id: randomUUID(),
    programmeId: SYSTEM_PROGRAMME,
    aggregateId: id,
    entityType: 'USER',
    entityId: id,
    action: 'ADMIN_BOOTSTRAPPED',
    actorSubject: id,
    timestamp,
    correlationId: randomUUID(),
  };

  // Atomic: the ACTIVE admin user, its ADMIN assignment and the audit event are
  // created together. An interrupted bootstrap rolls everything back and is
  // safely retryable — it never leaves an ACTIVE admin without an assignment.
  try {
    await deps.identity.createAdminAtomically({ user, assignment, audit });
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      // A concurrent bootstrap won the race — treat as idempotent no-op.
      const winner = await deps.identity.getUserByEmail(email);
      return {
        created: false,
        userId: winner?.id ?? id,
        email,
        reason: 'An account with this email already exists; no change made.',
      };
    }
    throw error;
  }

  return { created: true, userId: id, email };
}
