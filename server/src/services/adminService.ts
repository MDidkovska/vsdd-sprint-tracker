/**
 * Admin approval / assignment service (Phase 8, task 8.2 + repair).
 *
 * The vendor-neutral business layer behind the admin endpoints (design.md §6):
 *   GET  /api/v1/admin/users?status=PENDING
 *   POST /api/v1/admin/users/{userId}/approve
 *   POST /api/v1/admin/users/{userId}/reject
 *   PUT  /api/v1/admin/users/{userId}/assignments
 *   POST /api/v1/admin/users/{userId}/suspend
 *
 * The Admin pending queue is simply `users` filtered by `status=PENDING` — there
 * is no separate access-request collection; `auditEvents` retains the decision
 * history (requirements.md R1a.6).
 *
 * Every method requires an Admin principal and refuses self-service escalation
 * (R1.8). Assignments are validated server-side against real reference data:
 * the programme must exist, every team must exist, be active and belong to that
 * programme, and Contributor/Team-Lead assignments require at least one team;
 * phantom or cross-programme ids are rejected with VALIDATION_FAILED. Approval,
 * assignment change, rejection and suspension are written ATOMICALLY (status +
 * assignment + session revocation + audit succeed or roll back together), so an
 * interrupted workflow never leaves an ACTIVE user without an assignment or a
 * status change without its audit record (R1.4). Responses use the
 * {@link PublicUser} projection so a password hash can never leak (R1.2).
 */
import { randomUUID } from 'node:crypto';
import type {
  AccountStatus,
  Assignment,
  AssignmentInput,
  PublicUser,
} from '../domain/accounts.js';
import { toPublicUser } from '../domain/accounts.js';
import type { AuditAction, AuditEvent } from '../domain/documents.js';
import type { Programme, Team } from '../domain/hierarchy.js';
import { ROLES, type Role } from '../domain/identity.js';
import type { AuthContext } from '../auth/mockAuth.js';
import { assertAdmin } from '../auth/authorization.js';
import { ApiError, type FieldError } from '../http/errorEnvelope.js';
import type { IdentityRepository } from '../repository/identityRepository.js';

const SYSTEM_PROGRAMME = 'system';

/** Reference reads needed to validate assignments against real hierarchy data. */
export interface AdminReferenceReadPort {
  getProgramme(programmeId: string): Promise<Programme | null>;
  listTeams(programmeId: string): Promise<Team[]>;
}

export interface AdminServiceDeps {
  identity: IdentityRepository;
  reference: AdminReferenceReadPort;
  auth: AuthContext;
  now?: () => number;
}

export interface AdminApi {
  listUsers(status?: AccountStatus): Promise<PublicUser[]>;
  approve(userId: string, assignment: AssignmentInput): Promise<PublicUser>;
  reject(userId: string): Promise<PublicUser>;
  updateAssignments(userId: string, assignment: AssignmentInput): Promise<PublicUser>;
  suspend(userId: string): Promise<PublicUser>;
}

const EDITOR_ROLES: Role[] = ['CONTRIBUTOR', 'TEAM_LEAD'];

export class AdminService implements AdminApi {
  private readonly deps: AdminServiceDeps;
  private readonly now: () => number;

  constructor(deps: AdminServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  async listUsers(status?: AccountStatus): Promise<PublicUser[]> {
    assertAdmin(this.deps.auth.getCurrentUser());
    const users = await this.deps.identity.listUsers(status);
    return Promise.all(
      users.map(async (user) =>
        toPublicUser(user, await this.deps.identity.getAssignment(user.id)),
      ),
    );
  }

  async approve(userId: string, assignment: AssignmentInput): Promise<PublicUser> {
    const actor = this.requireAdminNotSelf(userId);
    const user = await this.requireUser(userId);
    if (user.status !== 'PENDING') {
      throw ApiError.invalidState('Only a pending user can be approved.');
    }
    const clean = await this.validateAssignment(assignment);
    const timestamp = new Date(this.now()).toISOString();
    const record = this.assignmentRecord(userId, clean, timestamp);

    // Atomic: ACTIVE status + assignment + both audits together (R1.4).
    const updated = await this.deps.identity.approveUserWithAssignment({
      userId,
      status: 'ACTIVE',
      updatedAt: timestamp,
      assignment: record,
      audits: [
        this.auditEvent('USER_APPROVED', actor.subject, userId, timestamp),
        this.auditEvent('ASSIGNMENT_CHANGED', actor.subject, userId, timestamp),
      ],
    });
    return toPublicUser(updated, record);
  }

  async updateAssignments(
    userId: string,
    assignment: AssignmentInput,
  ): Promise<PublicUser> {
    const actor = this.requireAdminNotSelf(userId);
    const user = await this.requireUser(userId);
    if (user.status !== 'ACTIVE') {
      throw ApiError.invalidState('Only an active user\u2019s assignments can be modified.');
    }
    const clean = await this.validateAssignment(assignment);
    const timestamp = new Date(this.now()).toISOString();
    const record = this.assignmentRecord(userId, clean, timestamp);

    await this.deps.identity.updateAssignmentWithAudit({
      assignment: record,
      audit: this.auditEvent('ASSIGNMENT_CHANGED', actor.subject, userId, timestamp),
    });
    return toPublicUser(user, record);
  }

  async reject(userId: string): Promise<PublicUser> {
    const actor = this.requireAdminNotSelf(userId);
    const user = await this.requireUser(userId);
    if (user.status !== 'PENDING') {
      throw ApiError.invalidState('Only a pending user can be rejected.');
    }
    const timestamp = new Date(this.now()).toISOString();
    const updated = await this.deps.identity.changeUserStatusWithAudit({
      userId,
      status: 'REJECTED',
      updatedAt: timestamp,
      audit: this.auditEvent('USER_REJECTED', actor.subject, userId, timestamp),
      revokeSessions: true,
    });
    const assignment = await this.deps.identity.getAssignment(userId);
    return toPublicUser(updated, assignment);
  }

  async suspend(userId: string): Promise<PublicUser> {
    const actor = this.requireAdminNotSelf(userId);
    const user = await this.requireUser(userId);
    if (user.status !== 'ACTIVE') {
      throw ApiError.invalidState('Only an active user can be suspended.');
    }
    const timestamp = new Date(this.now()).toISOString();
    const updated = await this.deps.identity.changeUserStatusWithAudit({
      userId,
      status: 'SUSPENDED',
      updatedAt: timestamp,
      audit: this.auditEvent('USER_SUSPENDED', actor.subject, userId, timestamp),
      revokeSessions: true,
    });
    const assignment = await this.deps.identity.getAssignment(userId);
    return toPublicUser(updated, assignment);
  }

  /** Assert the caller is an admin and is not acting on their own account (R1.8). */
  private requireAdminNotSelf(userId: string) {
    const actor = this.deps.auth.getCurrentUser();
    assertAdmin(actor);
    if (actor.subject === userId) {
      throw new ApiError(
        'PERMISSION_DENIED',
        'You cannot approve, reject, suspend or assign roles to your own account.',
      );
    }
    return actor;
  }

  private async requireUser(userId: string) {
    const user = await this.deps.identity.getUserById(userId);
    if (!user) {
      throw ApiError.notFound(`User "${userId}" was not found.`);
    }
    return user;
  }

  private assignmentRecord(
    userId: string,
    clean: AssignmentInput,
    timestamp: string,
  ): Assignment {
    return {
      id: userId,
      userId,
      programmeId: clean.programmeId,
      teamIds: clean.teamIds,
      roles: clean.roles,
      updatedAt: timestamp,
    };
  }

  /**
   * Validate and normalise an assignment against REAL reference data
   * (server-side): valid roles (>=1), an existing programme, and teamIds that
   * all exist, are active and belong to that programme. Contributor/Team-Lead
   * assignments require at least one team. Anything else is VALIDATION_FAILED.
   */
  private async validateAssignment(input: AssignmentInput): Promise<AssignmentInput> {
    const errors: FieldError[] = [];
    const roles = Array.isArray(input.roles) ? [...new Set(input.roles)] : [];
    const invalidRole = roles.find((r) => !ROLES.includes(r as Role));
    if (invalidRole) {
      errors.push({ path: 'roles', message: `Unknown role: ${String(invalidRole)}.` });
    }
    if (roles.length === 0) {
      errors.push({ path: 'roles', message: 'Assign at least one role.' });
    }

    const teamIds = Array.isArray(input.teamIds) ? [...new Set(input.teamIds)] : [];
    if (teamIds.some((t) => typeof t !== 'string' || t.trim() === '')) {
      errors.push({ path: 'teamIds', message: 'Team ids must be non-empty strings.' });
    }

    // Programme must exist.
    const programmeId = input.programmeId;
    let programmeTeamIds = new Set<string>();
    if (!programmeId) {
      errors.push({ path: 'programmeId', message: 'A programme is required.' });
    } else {
      const programme = await this.deps.reference.getProgramme(programmeId);
      if (!programme) {
        errors.push({ path: 'programmeId', message: `Unknown programme: ${programmeId}.` });
      } else {
        const teams = await this.deps.reference.listTeams(programmeId);
        programmeTeamIds = new Set(teams.filter((t) => t.active).map((t) => t.id));
      }
    }

    // Every team must exist, be active and belong to the programme.
    if (programmeId && programmeTeamIds.size >= 0) {
      const invalidTeam = teamIds.find((t) => !programmeTeamIds.has(t));
      if (invalidTeam) {
        errors.push({
          path: 'teamIds',
          message: `Team "${invalidTeam}" does not exist, is not active, or is not in programme "${programmeId}".`,
        });
      }
    }

    // Contributor / Team Lead assignments must include at least one team.
    const needsTeam = roles.some((r) => EDITOR_ROLES.includes(r as Role));
    if (needsTeam && teamIds.length === 0) {
      errors.push({
        path: 'teamIds',
        message: 'A Contributor or Team Lead must be assigned at least one team.',
      });
    }

    if (errors.length > 0) {
      throw ApiError.validation('Check the assignment and try again.', errors);
    }

    return { programmeId: programmeId ?? null, teamIds, roles: roles as Role[] };
  }

  private auditEvent(
    action: AuditAction,
    actorSubject: string,
    userId: string,
    timestamp: string,
  ): AuditEvent {
    return {
      id: randomUUID(),
      programmeId: SYSTEM_PROGRAMME,
      aggregateId: userId,
      entityType: 'USER',
      entityId: userId,
      action,
      actorSubject,
      timestamp,
      correlationId: randomUUID(),
    };
  }
}
