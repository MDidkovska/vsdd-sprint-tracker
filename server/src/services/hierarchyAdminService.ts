/**
 * Programme hierarchy / reporting-cycle administration service (Phase 9, task 9.5).
 *
 * The vendor-neutral business layer behind the Programme-Admin configuration
 * endpoints (design.md §6, requirements.md R2, R17). It lets an Admin configure
 * the programme hierarchy (streams, teams) and the reporting cycle (sprints and
 * their two weekly checkpoints) WITHOUT a code deployment (R17.1).
 *
 * Authorisation is system-level Admin (design.md §5a): every method calls
 * {@link assertAdmin} on the request principal, so a hidden UI control is never
 * the authorisation boundary (R1.6, default-deny). All referential validation
 * (programme/stream must exist, team name unique within its stream for the
 * active period, exactly two weekly checkpoints, exactly one CURRENT checkpoint)
 * lives here — the repository exposes only neutral, ATOMIC writes.
 *
 * Every mutation is a SINGLE atomic repository call that bundles the config
 * write(s) with the append-only audit event (design.md §4a). The service never
 * issues sequential independent writes, so a hierarchy/sprint/checkpoint change
 * can never leave a partial document or an orphan audit event. Audit events
 * carry stable ids only, never user-authored content (design.md §14, R15).
 */
import { randomUUID } from 'node:crypto';
import type { AuditAction, AuditEntityType, AuditEvent } from '../domain/documents.js';
import type {
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type { CurrentUser } from '../domain/identity.js';
import type { AuthContext } from '../auth/mockAuth.js';
import { assertAdmin } from '../auth/authorization.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { DocumentRepository } from '../repository/documentRepository.js';

/** One week in milliseconds — the spacing between the two weekly checkpoints. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Narrow persistence port: exactly the reference/config reads and ATOMIC writes
 * this service needs. It is a structural subset of {@link DocumentRepository},
 * so the production Mongo adapter and any in-memory test/rollback fake satisfy
 * it without the service depending on the whole contract (design.md §4b). Each
 * write method bundles its audit event so the service issues no sequential
 * independent writes.
 */
export type HierarchyAdminRepository = Pick<
  DocumentRepository,
  | 'getProgramme'
  | 'getStream'
  | 'saveStreamWithAudit'
  | 'getTeam'
  | 'listTeams'
  | 'saveTeamWithAudit'
  | 'getSprint'
  | 'createSprint'
  | 'getCheckpoint'
  | 'listCheckpoints'
  | 'saveCheckpointsWithAudit'
>;

export interface CreateStreamInput {
  id: string;
  programmeId: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateStreamInput {
  id: string;
  name?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface CreateTeamInput {
  id: string;
  programmeId: string;
  streamId: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateTeamInput {
  id: string;
  name?: string;
  sortOrder?: number;
  active?: boolean;
}

export interface CreateSprintInput {
  id: string;
  programmeId: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface HierarchyAdminApi {
  createStream(input: CreateStreamInput): Promise<Stream>;
  updateStream(input: UpdateStreamInput): Promise<Stream>;
  createTeam(input: CreateTeamInput): Promise<Team>;
  updateTeam(input: UpdateTeamInput): Promise<Team>;
  archiveTeam(teamId: string): Promise<Team>;
  createSprint(
    input: CreateSprintInput,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }>;
  setCurrentCheckpoint(checkpointId: string): Promise<ReportingCheckpoint>;
  closeCheckpoint(checkpointId: string): Promise<ReportingCheckpoint>;
  reopenCheckpoint(checkpointId: string, reason: string): Promise<ReportingCheckpoint>;
}

export interface HierarchyAdminServiceDeps {
  repository: HierarchyAdminRepository;
  auth: AuthContext;
  now?: () => number;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

export class HierarchyAdminService implements HierarchyAdminApi {
  private readonly repository: HierarchyAdminRepository;
  private readonly auth: AuthContext;
  private readonly now: () => number;

  constructor(deps: HierarchyAdminServiceDeps) {
    this.repository = deps.repository;
    this.auth = deps.auth;
    this.now = deps.now ?? Date.now;
  }

  /** Assert the caller is an Admin and return the principal. */
  private requireAdmin(): CurrentUser {
    const actor = this.auth.getCurrentUser();
    assertAdmin(actor);
    return actor;
  }

  private async assertProgrammeExists(programmeId: string): Promise<void> {
    if (!programmeId || !programmeId.trim()) {
      throw ApiError.validation('A programme is required.', [
        { path: 'programmeId', message: 'A programme is required.' },
      ]);
    }
    const programme = await this.repository.getProgramme(programmeId);
    if (!programme) {
      throw ApiError.validation(`Unknown programme: ${programmeId}.`, [
        { path: 'programmeId', message: `Unknown programme: ${programmeId}.` },
      ]);
    }
  }

  /** Resolve a stream and assert it belongs to the named programme. */
  private async assertStreamInProgramme(
    streamId: string,
    programmeId: string,
  ): Promise<Stream> {
    const stream = await this.repository.getStream(streamId);
    if (!stream) {
      throw ApiError.validation(`Unknown stream: ${streamId}.`, [
        { path: 'streamId', message: `Unknown stream: ${streamId}.` },
      ]);
    }
    if (stream.programmeId !== programmeId) {
      throw ApiError.validation(
        `Stream "${streamId}" does not belong to programme "${programmeId}".`,
        [{ path: 'streamId', message: 'Stream is not in this programme.' }],
      );
    }
    return stream;
  }

  /**
   * Assert no other ACTIVE team in the same stream already uses `name`
   * (case-insensitive). Team names are unique within a stream for the active
   * period; an archived (inactive) team never blocks reuse (R17.3).
   */
  private async assertTeamNameFree(
    programmeId: string,
    streamId: string,
    name: string,
    exceptTeamId?: string,
  ): Promise<void> {
    const teams = await this.repository.listTeams(programmeId);
    const clash = teams.some(
      (t) =>
        t.streamId === streamId &&
        t.active &&
        t.id !== exceptTeamId &&
        t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw ApiError.validation(
        `A team named "${name}" already exists in this stream.`,
        [{ path: 'name', message: 'Team name must be unique within the stream.' }],
      );
    }
  }

  async createStream(input: CreateStreamInput): Promise<Stream> {
    const actor = this.requireAdmin();
    await this.assertProgrammeExists(input.programmeId);
    const name = input.name?.trim();
    if (!name) {
      throw ApiError.validation('A stream name is required.', [
        { path: 'name', message: 'A stream name is required.' },
      ]);
    }
    const stream: Stream = {
      id: input.id,
      programmeId: input.programmeId,
      name,
      sortOrder: input.sortOrder ?? 0,
      active: true,
    };
    const audit = this.buildAudit(actor, 'HIERARCHY_CHANGED', 'STREAM', stream.id, stream.programmeId);
    return this.repository.saveStreamWithAudit(stream, audit);
  }

  async updateStream(input: UpdateStreamInput): Promise<Stream> {
    const actor = this.requireAdmin();
    const existing = await this.repository.getStream(input.id);
    if (!existing) {
      throw ApiError.notFound(`Stream "${input.id}" was not found.`);
    }
    const nextName = input.name?.trim() || existing.name;
    const updated: Stream = {
      ...existing,
      name: nextName,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      active: input.active ?? existing.active,
    };
    const audit = this.buildAudit(actor, 'HIERARCHY_CHANGED', 'STREAM', updated.id, updated.programmeId);
    return this.repository.saveStreamWithAudit(updated, audit);
  }

  async createTeam(input: CreateTeamInput): Promise<Team> {
    const actor = this.requireAdmin();
    await this.assertProgrammeExists(input.programmeId);
    await this.assertStreamInProgramme(input.streamId, input.programmeId);
    const name = input.name?.trim();
    if (!name) {
      throw ApiError.validation('A team name is required.', [
        { path: 'name', message: 'A team name is required.' },
      ]);
    }
    await this.assertTeamNameFree(input.programmeId, input.streamId, name);
    const team: Team = {
      id: input.id,
      streamId: input.streamId,
      name,
      sortOrder: input.sortOrder ?? 0,
      active: true,
    };
    const audit = this.buildAudit(actor, 'HIERARCHY_CHANGED', 'TEAM', team.id, input.programmeId);
    return this.repository.saveTeamWithAudit(team, audit);
  }

  async updateTeam(input: UpdateTeamInput): Promise<Team> {
    const actor = this.requireAdmin();
    const existing = await this.repository.getTeam(input.id);
    if (!existing) {
      throw ApiError.notFound(`Team "${input.id}" was not found.`);
    }
    const stream = await this.repository.getStream(existing.streamId);
    if (!stream) {
      throw ApiError.validation(`Unknown stream: ${existing.streamId}.`);
    }
    const nextName = input.name?.trim() || existing.name;
    const nextActive = input.active ?? existing.active;
    // A rename that keeps the team active must not collide with a sibling.
    if (nextActive && nextName.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertTeamNameFree(stream.programmeId, existing.streamId, nextName, existing.id);
    }
    const updated: Team = {
      ...existing,
      name: nextName,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      active: nextActive,
    };
    const audit = this.buildAudit(actor, 'HIERARCHY_CHANGED', 'TEAM', updated.id, stream.programmeId);
    return this.repository.saveTeamWithAudit(updated, audit);
  }

  /**
   * Archive a team (R17.2, R17.4). Archival is a NON-DESTRUCTIVE reference/config
   * write: it marks the team inactive and stamps `archivedAt`, but NEVER removes
   * the team document, its prior submitted {@link UpdateVersion}s, drafts,
   * exceptions, decisions or audit events. An archived team drops out of the
   * ACTIVE hierarchy/reporting projection (the read services already filter on
   * `team.active`), while its historical submitted versions and audit history
   * stay fully readable through the version/audit endpoints (design.md §4a).
   *
   * Programme-scoped and anti-enumeration: a phantom team id, or a team whose
   * stream belongs to another programme than the admin's, is rejected as
   * VALIDATION_FAILED with the same message so an id cannot be probed. Archiving
   * an already-archived team is idempotent — it returns the team unchanged and
   * appends no further audit event. The write bundles the config change and the
   * append-only audit event as one atomic unit (design.md §4a).
   */
  async archiveTeam(teamId: string): Promise<Team> {
    const actor = this.requireAdmin();
    if (!teamId || !teamId.trim()) {
      throw ApiError.validation('A team is required.', [
        { path: 'teamId', message: 'A team is required.' },
      ]);
    }
    // Resolve the team + its stream. A phantom id or a stream in another
    // programme is reported with the SAME validation error so an id cannot be
    // enumerated across programmes (design.md §5a anti-enumeration).
    const rejectUnknown = (): never => {
      throw ApiError.validation(`Unknown team: ${teamId}.`, [
        { path: 'teamId', message: `Unknown team: ${teamId}.` },
      ]);
    };
    const existing = await this.repository.getTeam(teamId);
    if (!existing) {
      rejectUnknown();
    }
    const team = existing as Team;
    const stream = await this.repository.getStream(team.streamId);
    if (!stream) {
      rejectUnknown();
    }
    const owningStream = stream as Stream;
    if (actor.programmeId && owningStream.programmeId !== actor.programmeId) {
      rejectUnknown();
    }
    // Idempotent: an already-archived team is returned untouched (no new audit).
    if (!team.active && team.archivedAt) {
      return team;
    }
    const archived: Team = {
      ...team,
      active: false,
      archivedAt: new Date(this.now()).toISOString(),
    };
    const audit = this.buildAudit(
      actor,
      'HIERARCHY_CHANGED',
      'TEAM',
      archived.id,
      owningStream.programmeId,
    );
    return this.repository.saveTeamWithAudit(archived, audit);
  }

  async createSprint(
    input: CreateSprintInput,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }> {
    const actor = this.requireAdmin();
    await this.assertProgrammeExists(input.programmeId);
    const label = input.label?.trim();
    if (!label) {
      throw ApiError.validation('A sprint label is required.', [
        { path: 'label', message: 'A sprint label is required.' },
      ]);
    }
    if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) {
      throw ApiError.validation('Sprint start and end dates must be valid ISO dates.', [
        { path: 'startDate', message: 'Must be a valid ISO date.' },
      ]);
    }
    const start = Date.parse(input.startDate);
    const end = Date.parse(input.endDate);
    if (end < start) {
      throw ApiError.validation('Sprint end date must not precede its start date.', [
        { path: 'endDate', message: 'End date must not precede start date.' },
      ]);
    }
    const sprint: Sprint = {
      id: input.id,
      programmeId: input.programmeId,
      label,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'PLANNED',
    };
    const midIso = new Date(start + WEEK_MS).toISOString();
    // Exactly two weekly reporting checkpoints (R2.1).
    const checkpoints: ReportingCheckpoint[] = [
      {
        id: `${sprint.id}-W1`,
        sprintId: sprint.id,
        weekNumber: 1,
        opensAt: input.startDate,
        dueAt: midIso,
        closesAt: midIso,
        status: 'UPCOMING',
      },
      {
        id: `${sprint.id}-W2`,
        sprintId: sprint.id,
        weekNumber: 2,
        opensAt: midIso,
        dueAt: input.endDate,
        closesAt: input.endDate,
        status: 'UPCOMING',
      },
    ];
    const audit = this.buildAudit(actor, 'SPRINT_CREATED', 'SPRINT', sprint.id, sprint.programmeId);
    // Atomic: sprint + its two checkpoints + audit commit together or not at all.
    return this.repository.createSprint(sprint, checkpoints, audit);
  }

  async setCurrentCheckpoint(checkpointId: string): Promise<ReportingCheckpoint> {
    const actor = this.requireAdmin();
    const target = await this.requireCheckpoint(checkpointId);
    if (target.status === 'CLOSED') {
      throw new ApiError(
        'WINDOW_CLOSED',
        'This reporting window is closed. Reopen it before making it current.',
      );
    }
    const toSave = await this.currentDemotionSet(target);
    const audit = await this.buildCheckpointAudit(actor, target);
    // Atomic: promote target + demote previous current + audit as one unit.
    const saved = await this.repository.saveCheckpointsWithAudit(toSave, audit);
    return saved.find((cp) => cp.id === target.id) ?? { ...target, status: 'CURRENT' };
  }

  async closeCheckpoint(checkpointId: string): Promise<ReportingCheckpoint> {
    const actor = this.requireAdmin();
    const target = await this.requireCheckpoint(checkpointId);
    if (target.status === 'CLOSED') {
      return target;
    }
    const closed: ReportingCheckpoint = { ...target, status: 'CLOSED' };
    const audit = await this.buildCheckpointAudit(actor, closed);
    const [saved] = await this.repository.saveCheckpointsWithAudit([closed], audit);
    return saved ?? closed;
  }

  async reopenCheckpoint(checkpointId: string, reason: string): Promise<ReportingCheckpoint> {
    const actor = this.requireAdmin();
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw ApiError.validation('A reason is required to reopen a reporting window.', [
        { path: 'reason', message: 'A reason is required to reopen a reporting window.' },
      ]);
    }
    const target = await this.requireCheckpoint(checkpointId);
    if (target.status !== 'CLOSED') {
      throw ApiError.invalidState('Only a closed reporting window can be reopened.');
    }
    const toSave = await this.currentDemotionSet(target);
    const audit = await this.buildCheckpointAudit(actor, target, trimmed);
    const saved = await this.repository.saveCheckpointsWithAudit(toSave, audit);
    return saved.find((cp) => cp.id === target.id) ?? { ...target, status: 'CURRENT' };
  }

  /**
   * Compute the checkpoint set that makes `target` the single CURRENT checkpoint
   * of its sprint: the target promoted to CURRENT, plus any other CURRENT
   * checkpoint demoted to CLOSED. The set is written ATOMICALLY by the caller so
   * "exactly one CURRENT" is never observable as multiple/zero CURRENT (R2.2).
   */
  private async currentDemotionSet(
    target: ReportingCheckpoint,
  ): Promise<ReportingCheckpoint[]> {
    const siblings = await this.repository.listCheckpoints(target.sprintId);
    const toSave: ReportingCheckpoint[] = [{ ...target, status: 'CURRENT' }];
    for (const cp of siblings) {
      if (cp.id !== target.id && cp.status === 'CURRENT') {
        toSave.push({ ...cp, status: 'CLOSED' });
      }
    }
    return toSave;
  }

  private async requireCheckpoint(checkpointId: string): Promise<ReportingCheckpoint> {
    const checkpoint = await this.repository.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw ApiError.notFound(`Checkpoint "${checkpointId}" was not found.`);
    }
    return checkpoint;
  }

  private async buildCheckpointAudit(
    actor: CurrentUser,
    checkpoint: ReportingCheckpoint,
    reason?: string,
  ): Promise<AuditEvent> {
    const sprint = await this.repository.getSprint(checkpoint.sprintId);
    const programmeId = sprint?.programmeId ?? (actor.programmeId ?? 'system');
    return this.buildAudit(
      actor,
      'CHECKPOINT_CHANGED',
      'CHECKPOINT',
      checkpoint.id,
      programmeId,
      checkpoint.sprintId,
      reason,
    );
  }

  /**
   * Build an append-only audit event. Carries stable ids and an optional short
   * reason only — never user-authored update content (design.md §14). The event
   * is persisted ATOMICALLY with its config write by the repository.
   */
  private buildAudit(
    actor: CurrentUser,
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: string,
    programmeId: string,
    aggregateId?: string,
    reason?: string,
  ): AuditEvent {
    const timestamp = new Date(this.now()).toISOString();
    return {
      id: randomUUID(),
      programmeId,
      aggregateId: aggregateId ?? programmeId,
      entityType,
      entityId,
      action,
      actorSubject: actor.subject,
      timestamp,
      correlationId: randomUUID(),
      ...(reason ? { reason } : {}),
    };
  }
}
