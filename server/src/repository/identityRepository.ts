/**
 * Vendor-neutral identity persistence ports (Phase 8, design.md §5a).
 *
 * These are the narrow persistence seams for local-account authentication over
 * the `users`, `assignments` and `sessions` collections. Like the rest of the
 * persistence layer, MongoDB-specific code lives ONLY in the adapter that
 * implements them (`mongoDocumentRepository.ts`); nothing here mentions MongoDB
 * (design.md §4b vendor-neutral boundary).
 *
 * They are split into three small interfaces so a service depends only on what
 * it needs (e.g. the request authenticator needs sessions + users + assignments
 * for reads; registration needs the user + assignment writes).
 */
import type {
  Assignment,
  AccountStatus,
  SessionRecord,
  UserAccount,
} from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import type { AuditPageResult, AuditQuery } from './documentRepository.js';

export interface UserStore {
  /**
   * Insert a new user. A duplicate id or email is rejected (the adapter maps a
   * duplicate-key error to an EMAIL_TAKEN ApiError). Email is stored lowercased.
   */
  insertUser(user: UserAccount): Promise<void>;
  getUserById(id: string): Promise<UserAccount | null>;
  /** Look up by (lowercased) email — the login identifier. */
  getUserByEmail(email: string): Promise<UserAccount | null>;
  /** List users, optionally filtered by status (the Admin queue). */
  listUsers(status?: AccountStatus): Promise<UserAccount[]>;
  /** Update a user's status; returns the updated user or null when absent. */
  updateUserStatus(
    id: string,
    status: AccountStatus,
    updatedAt: string,
  ): Promise<UserAccount | null>;
}

export interface AssignmentStore {
  getAssignment(userId: string): Promise<Assignment | null>;
  /** Create or replace a user's assignment (keyed by userId). */
  upsertAssignment(assignment: Assignment): Promise<void>;
}

export interface SessionStore {
  createSession(session: SessionRecord): Promise<void>;
  /** Look up by the token hash (the session id). */
  getSession(id: string): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;
  /** Revoke every session for a user (logout-all / suspension). */
  deleteSessionsForUser(userId: string): Promise<void>;
}

// --- atomic identity workflows (Phase 8 repair) ---------------------------
//
// Registration, approval, assignment change, rejection/suspension and the
// first-admin bootstrap each write to MORE THAN ONE collection (user +
// assignment + sessions + audit). These operations must be ATOMIC: a mid-way
// failure must roll everything back, so an interrupted workflow never leaves an
// ACTIVE user without an assignment, or a status change without its audit
// record (design.md §5a). The Mongo adapter implements them as a single
// transaction; the in-memory adapter implements genuine staged-commit rollback.

/** Registration: insert the user and append its USER_REGISTERED audit, atomically. */
export interface CreateUserAtomicInput {
  user: UserAccount;
  audit: AuditEvent;
}

/** Approval: set ACTIVE, write the assignment and append the audits, atomically. */
export interface ApproveUserAtomicInput {
  userId: string;
  status: AccountStatus;
  updatedAt: string;
  assignment: Assignment;
  audits: AuditEvent[];
}

/** Assignment change: replace the assignment and append the audit, atomically. */
export interface UpdateAssignmentAtomicInput {
  assignment: Assignment;
  audit: AuditEvent;
}

/**
 * Status change (rejection / suspension): update status, optionally revoke all
 * of the user's sessions, and append the audit — atomically.
 */
export interface ChangeStatusAtomicInput {
  userId: string;
  status: AccountStatus;
  updatedAt: string;
  audit: AuditEvent;
  revokeSessions: boolean;
}

/** Bootstrap: create the admin user + ADMIN assignment + audit, atomically. */
export interface CreateAdminAtomicInput {
  user: UserAccount;
  assignment: Assignment;
  audit: AuditEvent;
}

export interface IdentityWriteOps {
  createUserWithAudit(input: CreateUserAtomicInput): Promise<void>;
  approveUserWithAssignment(input: ApproveUserAtomicInput): Promise<UserAccount>;
  updateAssignmentWithAudit(input: UpdateAssignmentAtomicInput): Promise<void>;
  changeUserStatusWithAudit(input: ChangeStatusAtomicInput): Promise<UserAccount>;
  createAdminAtomically(input: CreateAdminAtomicInput): Promise<void>;
}

/** Append-only audit sink + query (shared with DocumentRepository). */
export interface AuditRepository {
  appendAudit(event: AuditEvent): Promise<AuditEvent>;
  queryAudit(query: AuditQuery): Promise<AuditPageResult>;
}

/** The combined identity repository the Mongo + in-memory adapters implement. */
export interface IdentityRepository
  extends UserStore,
    AssignmentStore,
    SessionStore,
    IdentityWriteOps,
    AuditRepository {}
