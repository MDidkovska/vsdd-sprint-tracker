/**
 * In-memory mock auth client (Phase 8, Phase A demo + tests).
 *
 * Simulates the local-account flow without a backend: registration creates a
 * PENDING user, an Admin approves/assigns, and login/logout manage an in-memory
 * session. It mirrors the backend rules the UI cares about (PENDING can sign in
 * but not access programme data; rejected/suspended are refused login; a user
 * can never act on their own admin account) so the screens behave identically
 * against the real HTTP client.
 *
 * Seeded accounts (password `password123`):
 *   admin@vsdd.test     ACTIVE  ADMIN
 *   lead@vsdd.test      ACTIVE  TEAM_LEAD (team mmm-a)
 *   pending@vsdd.test   PENDING (awaiting approval)
 */
import type { AccountStatus, CurrentUser, Role } from '../api/repository';
import {
  AuthError,
  type AssignmentInput,
  type AuditAction,
  type AuditEntry,
  type AuditListQuery,
  type AuditPage,
  type AuthClient,
  type LoginInput,
  type PublicUser,
  type RegisterInput,
  type RegistrationAccepted,
} from './authClient';

interface MockAccount {
  id: string;
  email: string;
  displayName: string;
  password: string;
  status: AccountStatus;
  requestedTeam?: string;
  roles: Role[];
  teamIds: string[];
  programmeId: string | null;
  createdAt: string;
  updatedAt: string;
}

function roleLabel(roles: Role[], status: AccountStatus): string {
  if (status !== 'ACTIVE') return 'Pending approval';
  if (roles.includes('ADMIN')) return 'Programme Admin';
  if (roles.includes('LEADERSHIP')) return 'Programme Leadership';
  if (roles.includes('AUDITOR')) return 'Auditor';
  if (roles.includes('TEAM_LEAD')) return 'Team Lead';
  if (roles.includes('CONTRIBUTOR')) return 'Team Contributor';
  return 'No role assigned';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function toPublic(a: MockAccount): PublicUser {
  return {
    id: a.id,
    email: a.email,
    displayName: a.displayName,
    status: a.status,
    ...(a.requestedTeam ? { requestedTeam: a.requestedTeam } : {}),
    roles: a.roles,
    teamIds: a.teamIds,
    programmeId: a.programmeId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function toPrincipal(a: MockAccount): CurrentUser {
  return {
    subject: a.id,
    email: a.email,
    displayName: a.displayName,
    initials: initials(a.displayName),
    roleLabel: roleLabel(a.roles, a.status),
    status: a.status,
    programmeId: a.programmeId,
    roles: a.roles,
    assignedTeamIds: a.teamIds,
    canViewAll:
      a.roles.includes('LEADERSHIP') || a.roles.includes('ADMIN') || a.roles.includes('AUDITOR'),
  };
}

export interface MockAuthClientOptions {
  /** Start already signed in as this seeded email (demo convenience). */
  initialUserEmail?: string;
}

export function createMockAuthClient(options: MockAuthClientOptions = {}): AuthClient {
  const now = () => new Date().toISOString();
  let counter = 0;
  const nextId = (p: string) => `${p}-${(counter += 1)}`;

  const accounts = new Map<string, MockAccount>();
  // Persisted-style audit log (survives across calls on this client instance),
  // recorded newest-last and served newest-first — mirroring the backend.
  const auditLog: AuditEntry[] = [];
  const record = (action: AuditAction, entityId: string, actorSubject: string) => {
    auditLog.push({
      id: nextId('audit'),
      action,
      actorSubject,
      entityType: 'USER',
      entityId,
      aggregateId: entityId,
      timestamp: now(),
      correlationId: nextId('corr'),
    });
  };
  const seed = (a: Omit<MockAccount, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = nextId('user');
    accounts.set(id, { ...a, id, createdAt: now(), updatedAt: now() });
  };
  seed({ email: 'admin@vsdd.test', displayName: 'Root Admin', password: 'password123', status: 'ACTIVE', roles: ['ADMIN'], teamIds: [], programmeId: 'vsdd' });
  seed({ email: 'lead@vsdd.test', displayName: 'Lee Lead', password: 'password123', status: 'ACTIVE', roles: ['TEAM_LEAD'], teamIds: ['mmm-a'], programmeId: 'vsdd' });
  seed({ email: 'auditor@vsdd.test', displayName: 'Ada Auditor', password: 'password123', status: 'ACTIVE', roles: ['AUDITOR'], teamIds: [], programmeId: 'vsdd' });
  seed({ email: 'pending@vsdd.test', displayName: 'Pat Pending', password: 'password123', status: 'PENDING', roles: [], teamIds: [], programmeId: null, requestedTeam: 'PTSB-VSDD MMM A' });

  const byEmail = (email: string): MockAccount | undefined =>
    [...accounts.values()].find((a) => a.email.toLowerCase() === email.trim().toLowerCase());

  let sessionUserId: string | null = null;
  if (options.initialUserEmail) {
    sessionUserId = byEmail(options.initialUserEmail)?.id ?? null;
  }

  const requireAdmin = (): MockAccount => {
    const actor = sessionUserId ? accounts.get(sessionUserId) : undefined;
    if (!actor || actor.status !== 'ACTIVE' || !actor.roles.includes('ADMIN')) {
      throw new AuthError('PERMISSION_DENIED', 'Administrator access is required.');
    }
    return actor;
  };

  const requireAuditReader = (): void => {
    const actor = sessionUserId ? accounts.get(sessionUserId) : undefined;
    if (
      !actor ||
      actor.status !== 'ACTIVE' ||
      !(actor.roles.includes('ADMIN') || actor.roles.includes('AUDITOR'))
    ) {
      throw new AuthError(
        'PERMISSION_DENIED',
        'Audit history is available to administrators and auditors only.',
      );
    }
  };

  const requireTarget = (userId: string, actor: MockAccount): MockAccount => {
    if (userId === actor.id) {
      throw new AuthError(
        'PERMISSION_DENIED',
        'You cannot approve, reject, suspend or assign roles to your own account.',
      );
    }
    const target = accounts.get(userId);
    if (!target) throw new AuthError('NOT_FOUND', 'User not found.');
    return target;
  };

  return {
    async getMe() {
      const account = sessionUserId ? accounts.get(sessionUserId) : undefined;
      if (!account || account.status === 'REJECTED' || account.status === 'SUSPENDED') {
        sessionUserId = null;
        return null;
      }
      return toPrincipal(account);
    },

    async register(input: RegisterInput): Promise<RegistrationAccepted> {
      const email = input.email.trim().toLowerCase();
      if (!input.displayName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AuthError('VALIDATION_FAILED', 'Enter a valid display name and email.');
      }
      if ((input.password ?? '').length < 10) {
        throw new AuthError('VALIDATION_FAILED', 'Use a password of at least 10 characters.');
      }
      // Anti-enumeration parity with the server (design.md §13 / task 10.3): a
      // registration for an email that is ALREADY registered must return the
      // SAME neutral acknowledgement as a brand-new one, so the response never
      // reveals whether an account exists. For a duplicate we therefore do NOT
      // create a second account, do NOT touch the stored one, and do NOT write
      // a USER_REGISTERED audit — but we still return the identical body.
      if (!byEmail(email)) {
        const id = nextId('user');
        const account: MockAccount = {
          id,
          email,
          displayName: input.displayName.trim(),
          password: input.password,
          status: 'PENDING',
          ...(input.requestedTeam?.trim() ? { requestedTeam: input.requestedTeam.trim() } : {}),
          roles: [],
          teamIds: [],
          programmeId: null,
          createdAt: now(),
          updatedAt: now(),
        };
        accounts.set(id, account);
        record('USER_REGISTERED', id, id);
      }
      // Derived ONLY from the request — never from any stored account — so the
      // shape is constant and new-email vs duplicate-email are indistinguishable.
      return { status: 'PENDING', email };
    },

    async login(input: LoginInput) {
      const account = byEmail(input.email);
      if (!account || account.password !== input.password) {
        record('LOGIN_FAILED', account?.id ?? 'unknown', account?.id ?? 'unknown');
        throw new AuthError('AUTH_FAILED', 'Email or password is incorrect.');
      }
      if (account.status === 'REJECTED' || account.status === 'SUSPENDED') {
        record('LOGIN_FAILED', account.id, account.id);
        throw new AuthError('ACCOUNT_INACTIVE', 'This account is not active.');
      }
      sessionUserId = account.id;
      return toPrincipal(account);
    },

    async logout() {
      if (sessionUserId) record('LOGOUT', sessionUserId, sessionUserId);
      sessionUserId = null;
    },

    async listUsers(status?: AccountStatus) {
      requireAdmin();
      return [...accounts.values()]
        .filter((a) => (status ? a.status === status : true))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toPublic);
    },

    async approve(userId: string, assignment: AssignmentInput) {
      const actor = requireAdmin();
      const target = requireTarget(userId, actor);
      if (target.status !== 'PENDING') {
        throw new AuthError('INVALID_STATE', 'Only a pending user can be approved.');
      }
      if (assignment.roles.length === 0) {
        throw new AuthError('VALIDATION_FAILED', 'Assign at least one role.');
      }
      target.status = 'ACTIVE';
      target.roles = [...new Set(assignment.roles)];
      target.teamIds = [...new Set(assignment.teamIds)];
      target.programmeId = assignment.programmeId;
      target.updatedAt = now();
      record('USER_APPROVED', target.id, actor.id);
      record('ASSIGNMENT_CHANGED', target.id, actor.id);
      return toPublic(target);
    },

    async reject(userId: string) {
      const actor = requireAdmin();
      const target = requireTarget(userId, actor);
      if (target.status !== 'PENDING') {
        throw new AuthError('INVALID_STATE', 'Only a pending user can be rejected.');
      }
      target.status = 'REJECTED';
      target.updatedAt = now();
      record('USER_REJECTED', target.id, actor.id);
      return toPublic(target);
    },

    async updateAssignments(userId: string, assignment: AssignmentInput) {
      const actor = requireAdmin();
      const target = requireTarget(userId, actor);
      if (target.status !== 'ACTIVE') {
        throw new AuthError('INVALID_STATE', 'Only an active user can be reassigned.');
      }
      if (assignment.roles.length === 0) {
        throw new AuthError('VALIDATION_FAILED', 'Assign at least one role.');
      }
      target.roles = [...new Set(assignment.roles)];
      target.teamIds = [...new Set(assignment.teamIds)];
      target.programmeId = assignment.programmeId;
      target.updatedAt = now();
      record('ASSIGNMENT_CHANGED', target.id, actor.id);
      return toPublic(target);
    },

    async suspend(userId: string) {
      const actor = requireAdmin();
      const target = requireTarget(userId, actor);
      if (target.status !== 'ACTIVE') {
        throw new AuthError('INVALID_STATE', 'Only an active user can be suspended.');
      }
      target.status = 'SUSPENDED';
      target.updatedAt = now();
      record('USER_SUSPENDED', target.id, actor.id);
      return toPublic(target);
    },

    async listAudit(query: AuditListQuery = {}): Promise<AuditPage> {
      requireAuditReader();
      const limit = Math.min(200, Math.max(1, query.limit ?? 50));
      const offset = Math.max(0, query.offset ?? 0);
      const filtered = auditLog.filter(
        (e) =>
          (query.userId ? e.aggregateId === query.userId : true) &&
          (query.entityId ? e.entityId === query.entityId : true) &&
          (query.action ? e.action === query.action : true),
      );
      const newestFirst = [...filtered].reverse();
      return {
        items: newestFirst.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      };
    },
  };
}
