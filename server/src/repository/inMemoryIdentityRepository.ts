/**
 * In-memory identity repository (Phase 8).
 *
 * A dependency-free implementation of the {@link IdentityRepository} plus an
 * append-only audit sink, used by the auth/admin service unit tests so they run
 * without MongoDB (the same spirit as the frontend mock repository). The Mongo
 * adapter's behaviour is covered separately by the persistence integration
 * tests. Email uniqueness, one-assignment-per-user and session expiry are
 * modelled here exactly as the real adapter enforces them.
 */
import type {
  Assignment,
  AccountStatus,
  SessionRecord,
  UserAccount,
} from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import type { AuditPageResult, AuditQuery } from './documentRepository.js';
import { DuplicateKeyError, RepositoryError } from './errors.js';
import type {
  ApproveUserAtomicInput,
  ChangeStatusAtomicInput,
  CreateAdminAtomicInput,
  CreateUserAtomicInput,
  IdentityRepository,
  UpdateAssignmentAtomicInput,
} from './identityRepository.js';

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly usersById = new Map<string, UserAccount>();
  private readonly assignmentsByUser = new Map<string, Assignment>();
  private readonly sessionsById = new Map<string, SessionRecord>();
  /** Append-only audit log (exposed for test assertions). */
  readonly auditEvents: AuditEvent[] = [];

  async insertUser(user: UserAccount): Promise<void> {
    const email = user.email.toLowerCase();
    for (const existing of this.usersById.values()) {
      if (existing.email.toLowerCase() === email) {
        throw new DuplicateKeyError('A user with this email already exists.');
      }
    }
    if (this.usersById.has(user.id)) {
      throw new DuplicateKeyError('A user with this id already exists.');
    }
    this.usersById.set(user.id, { ...user, email });
  }

  async getUserById(id: string): Promise<UserAccount | null> {
    const user = this.usersById.get(id);
    return user ? { ...user } : null;
  }

  async getUserByEmail(email: string): Promise<UserAccount | null> {
    const target = email.toLowerCase();
    for (const user of this.usersById.values()) {
      if (user.email.toLowerCase() === target) return { ...user };
    }
    return null;
  }

  async listUsers(status?: AccountStatus): Promise<UserAccount[]> {
    const all = [...this.usersById.values()].map((u) => ({ ...u }));
    const filtered = status ? all.filter((u) => u.status === status) : all;
    return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateUserStatus(
    id: string,
    status: AccountStatus,
    updatedAt: string,
  ): Promise<UserAccount | null> {
    const user = this.usersById.get(id);
    if (!user) return null;
    const updated = { ...user, status, updatedAt };
    this.usersById.set(id, updated);
    return { ...updated };
  }

  async getAssignment(userId: string): Promise<Assignment | null> {
    const assignment = this.assignmentsByUser.get(userId);
    return assignment ? { ...assignment } : null;
  }

  async upsertAssignment(assignment: Assignment): Promise<void> {
    this.assignmentsByUser.set(assignment.userId, { ...assignment });
  }

  async createSession(session: SessionRecord): Promise<void> {
    if (this.sessionsById.has(session.id)) {
      throw new DuplicateKeyError('A session with this id already exists.');
    }
    this.sessionsById.set(session.id, { ...session });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const session = this.sessionsById.get(id);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessionsById.delete(id);
      return null;
    }
    return { ...session };
  }

  async deleteSession(id: string): Promise<void> {
    this.sessionsById.delete(id);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    for (const [id, session] of this.sessionsById) {
      if (session.userId === userId) this.sessionsById.delete(id);
    }
  }

  /** Append-only audit sink (matches the DocumentRepository.appendAudit shape). */
  async appendAudit(event: AuditEvent): Promise<AuditEvent> {
    this.auditEvents.push({ ...event });
    return event;
  }

  /** Filtered, paginated, newest-first audit query (matches DocumentRepository). */
  async queryAudit(query: AuditQuery): Promise<AuditPageResult> {
    const filtered = this.auditEvents.filter(
      (e) =>
        (query.userId ? e.aggregateId === query.userId : true) &&
        (query.entityId ? e.entityId === query.entityId : true) &&
        (query.action ? e.action === query.action : true),
    );
    // Newest-first: reverse insertion order (stable when timestamps collide).
    const newestFirst = [...filtered].reverse();
    const page = newestFirst.slice(query.offset, query.offset + query.limit);
    return { events: page.map((e) => ({ ...e })), total: filtered.length };
  }

  /** Count of live sessions (test helper). */
  sessionCount(): number {
    return this.sessionsById.size;
  }

  // --- atomic identity workflows with staged-commit rollback ----------------
  //
  // These mirror the Mongo transactions. Each stages its writes with an undo
  // stack and checks {@link injectedFailure} at the mid-transaction point; a
  // thrown failure runs the undo stack in reverse, so NOTHING is left partially
  // written. Tests set `injectedFailure` to prove rollback.

  /** Test hook: when set, the NEXT atomic op throws at its mid-transaction point. */
  injectedFailure: Error | null = null;

  private failpoint(): void {
    if (this.injectedFailure) {
      const error = this.injectedFailure;
      this.injectedFailure = null;
      throw error;
    }
  }

  private assertEmailFree(email: string): void {
    const target = email.toLowerCase();
    for (const existing of this.usersById.values()) {
      if (existing.email.toLowerCase() === target) {
        throw new DuplicateKeyError('A user with this email already exists.');
      }
    }
  }

  async createUserWithAudit(input: CreateUserAtomicInput): Promise<void> {
    this.assertEmailFree(input.user.email);
    if (this.usersById.has(input.user.id)) {
      throw new DuplicateKeyError('A user with this id already exists.');
    }
    const undo: Array<() => void> = [];
    try {
      const stored = { ...input.user, email: input.user.email.toLowerCase() };
      this.usersById.set(stored.id, stored);
      undo.push(() => this.usersById.delete(stored.id));
      this.failpoint();
      this.auditEvents.push({ ...input.audit });
      undo.push(() => this.auditEvents.pop());
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async approveUserWithAssignment(input: ApproveUserAtomicInput): Promise<UserAccount> {
    const undo: Array<() => void> = [];
    try {
      const priorAssignment = this.assignmentsByUser.get(input.assignment.userId);
      this.assignmentsByUser.set(input.assignment.userId, { ...input.assignment });
      undo.push(() =>
        priorAssignment
          ? this.assignmentsByUser.set(input.assignment.userId, priorAssignment)
          : this.assignmentsByUser.delete(input.assignment.userId),
      );

      const priorUser = this.usersById.get(input.userId);
      if (!priorUser) throw new RepositoryError('NOT_FOUND', 'User not found.');
      const updatedUser = { ...priorUser, status: input.status, updatedAt: input.updatedAt };
      this.usersById.set(input.userId, updatedUser);
      undo.push(() => this.usersById.set(input.userId, priorUser));

      this.failpoint();

      for (const event of input.audits) {
        this.auditEvents.push({ ...event });
        undo.push(() => this.auditEvents.pop());
      }
      return { ...updatedUser };
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async updateAssignmentWithAudit(input: UpdateAssignmentAtomicInput): Promise<void> {
    const undo: Array<() => void> = [];
    try {
      const prior = this.assignmentsByUser.get(input.assignment.userId);
      this.assignmentsByUser.set(input.assignment.userId, { ...input.assignment });
      undo.push(() =>
        prior
          ? this.assignmentsByUser.set(input.assignment.userId, prior)
          : this.assignmentsByUser.delete(input.assignment.userId),
      );
      this.failpoint();
      this.auditEvents.push({ ...input.audit });
      undo.push(() => this.auditEvents.pop());
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async changeUserStatusWithAudit(input: ChangeStatusAtomicInput): Promise<UserAccount> {
    const undo: Array<() => void> = [];
    try {
      const priorUser = this.usersById.get(input.userId);
      if (!priorUser) throw new RepositoryError('NOT_FOUND', 'User not found.');
      const updatedUser = { ...priorUser, status: input.status, updatedAt: input.updatedAt };
      this.usersById.set(input.userId, updatedUser);
      undo.push(() => this.usersById.set(input.userId, priorUser));

      if (input.revokeSessions) {
        const removed: Array<[string, SessionRecord]> = [];
        for (const [id, session] of this.sessionsById) {
          if (session.userId === input.userId) {
            removed.push([id, session]);
          }
        }
        for (const [id] of removed) this.sessionsById.delete(id);
        undo.push(() => {
          for (const [id, session] of removed) this.sessionsById.set(id, session);
        });
      }

      this.failpoint();

      this.auditEvents.push({ ...input.audit });
      undo.push(() => this.auditEvents.pop());
      return { ...updatedUser };
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }

  async createAdminAtomically(input: CreateAdminAtomicInput): Promise<void> {
    this.assertEmailFree(input.user.email);
    if (this.usersById.has(input.user.id)) {
      throw new DuplicateKeyError('A user with this id already exists.');
    }
    const undo: Array<() => void> = [];
    try {
      const stored = { ...input.user, email: input.user.email.toLowerCase() };
      this.usersById.set(stored.id, stored);
      undo.push(() => this.usersById.delete(stored.id));

      const priorAssignment = this.assignmentsByUser.get(input.assignment.userId);
      this.assignmentsByUser.set(input.assignment.userId, { ...input.assignment });
      undo.push(() =>
        priorAssignment
          ? this.assignmentsByUser.set(input.assignment.userId, priorAssignment)
          : this.assignmentsByUser.delete(input.assignment.userId),
      );

      this.failpoint();

      this.auditEvents.push({ ...input.audit });
      undo.push(() => this.auditEvents.pop());
    } catch (error) {
      undo.reverse().forEach((u) => u());
      throw error;
    }
  }
}
