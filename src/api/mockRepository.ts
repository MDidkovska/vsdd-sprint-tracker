/**
 * In-memory mock repository (Phase A).
 *
 * Implements the same {@link Repository} contract the Phase B HTTP client will
 * implement. It supports: all eight seeded teams; Week 1 and Week 2 records;
 * loading latency; permission-denied and simulated failure; debounced-save
 * persistence; immutable submission + append-only audit; optimistic-concurrency
 * revision conflicts; and Draft / Missing / Submitted / Reopened / Stale states.
 *
 * Demonstration triggers (typed into any goal or the leadership ask):
 *   "#conflict"  -> the next save/submit simulates a concurrent edit (409).
 *   "#failsave"  -> the next save/submit simulates a transient failure.
 */
import { CURRENT_SCHEMA_VERSION, PROGRAMME_ID } from '../config';
import type {
  HierarchyTree,
  ReportingCheckpoint,
  Sprint,
} from '../domain/hierarchy';
import type {
  LeadershipSnapshot,
  LeadershipStreamGroup,
  LeadershipTeamCell,
  ResolvedUpdate,
} from '../domain/leadership';
import type {
  AuditEvent,
  LeadershipDecision,
  UpdateDocument,
  UpdatePayload,
  UpdateState,
  UpdateVersion,
} from '../domain/update';
import { deriveEnvelopeFlags } from '../domain/schemas';
import { applyFilters, flattenTeams } from '../domain/leadershipFiltering';
import {
  PermissionDeniedError,
  RepositoryError,
  RevisionConflictError,
  type CurrentUser,
  type DecisionInput,
  type ExportInput,
  type ExportSnapshot,
  type ReopenInput,
  type Repository,
  type Role,
  type SaveDraftInput,
  type SubmitInput,
  type UpdateLocator,
} from './repository';
import {
  ASSIGNED_TEAM_IDS,
  CHECKPOINTS,
  PROGRAMME,
  SPRINTS,
  STREAMS,
  TEAMS,
  buildSeededData,
  docKey,
} from './seed';

const MOCK_USER: CurrentUser = {
  subject: 'user-md',
  displayName: 'Maryna D.',
  initials: 'MD',
  roleLabel: 'Test Lead',
  roles: ['TEAM_LEAD', 'LEADERSHIP'],
  assignedTeamIds: ASSIGNED_TEAM_IDS,
  canViewAll: true,
};

export interface MockRepositoryOptions {
  /** Artificial latency (ms) so loading states are visible. 0 in tests. */
  latencyMs?: number;
  /** Override the current user (role/assignment negative tests). */
  user?: CurrentUser;
}

function emptyPayload(): UpdatePayload {
  return {
    goals: { business: '', technicalTesting: '', sprintCommitment: '', nextWeekCommitment: '' },
    qualityEvidence: { planned: 0, executed: 0, passed: 0, openCritical: 0, blocked: 0, automationPercent: 0 },
    achievements: '',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: '',
    statusRationale: '',
    metricsNote: '',
  };
}

function payloadText(payload: UpdatePayload): string {
  return [
    payload.goals.business,
    payload.goals.technicalTesting,
    payload.goals.sprintCommitment,
    payload.goals.nextWeekCommitment,
    payload.leadershipAsk,
  ]
    .join(' ')
    .toLowerCase();
}

export class MockRepository implements Repository {
  private documents: Map<string, UpdateDocument>;
  private versions: UpdateVersion[];
  private audit: AuditEvent[] = [];
  private decisions: LeadershipDecision[] = [];
  private conflictArmed: Set<string>;
  private readonly latencyMs: number;
  private readonly user: CurrentUser;
  private counter = 0;

  constructor(options: MockRepositoryOptions = {}) {
    const seeded = buildSeededData();
    this.documents = seeded.documents;
    this.versions = seeded.versions;
    this.conflictArmed = seeded.conflictArmedDocIds;
    this.latencyMs = options.latencyMs ?? 220;
    this.user = options.user ?? MOCK_USER;
  }

  private hasRole(role: Role): boolean {
    return this.user.roles.includes(role);
  }

  private isAssigned(teamId: string): boolean {
    return this.user.assignedTeamIds.includes(teamId);
  }

  /** Draft editing: assigned Contributor or Team Lead. */
  private assertCanEditDraft(locator: UpdateLocator): void {
    const canEdit = this.isAssigned(locator.teamId) && (this.hasRole('CONTRIBUTOR') || this.hasRole('TEAM_LEAD'));
    if (!canEdit) throw new PermissionDeniedError();
    this.assertWindowOpen(locator);
  }

  /** Submitting requires the Team Lead role on an assigned team. */
  private assertCanSubmit(locator: UpdateLocator): void {
    if (!this.isAssigned(locator.teamId) || !this.hasRole('TEAM_LEAD')) {
      throw new PermissionDeniedError('Only a Team Lead can submit an update.');
    }
    this.assertWindowOpen(locator);
  }

  private assertWindowOpen(locator: UpdateLocator): void {
    const checkpoint = CHECKPOINTS.find((c) => c.id === locator.checkpointId);
    if (checkpoint && checkpoint.status === 'CLOSED') {
      throw new RepositoryError(
        'WINDOW_CLOSED',
        'This reporting window is closed. Ask an authorised lead to reopen it.',
      );
    }
  }

  /** A submitted update is immutable until reopened (state-machine guard). */
  private assertNotSubmitted(key: string): void {
    if (this.documents.get(key)?.state === 'SUBMITTED') {
      throw new RepositoryError(
        'ALREADY_SUBMITTED',
        'This update is submitted and immutable. Reopen it before editing or resubmitting.',
      );
    }
  }

  private failIfTriggered(payload: UpdatePayload): void {
    if (payloadText(payload).includes('#failsave')) {
      throw new RepositoryError(
        'SAVE_FAILED',
        'The draft could not be saved. Your changes are kept for retry.',
      );
    }
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  async getCurrentUser(): Promise<CurrentUser> {
    await this.delay();
    return structuredClone(this.user);
  }

  async getHierarchy(programmeId: string): Promise<HierarchyTree> {
    await this.delay();
    if (programmeId !== PROGRAMME_ID) {
      throw new RepositoryError('NOT_FOUND', 'Programme not found.');
    }
    return {
      programme: structuredClone(PROGRAMME),
      streams: [...STREAMS]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((stream) => ({
          stream: structuredClone(stream),
          teams: TEAMS.filter((t) => t.streamId === stream.id && t.active)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((t) => structuredClone(t)),
        })),
    };
  }

  async getSprints(programmeId: string): Promise<Sprint[]> {
    await this.delay();
    return SPRINTS.filter((s) => s.programmeId === programmeId).map((s) => structuredClone(s));
  }

  async getCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]> {
    await this.delay();
    return CHECKPOINTS.filter((c) => c.sprintId === sprintId)
      .sort((a, b) => a.weekNumber - b.weekNumber)
      .map((c) => structuredClone(c));
  }

  async getUpdate(locator: UpdateLocator): Promise<UpdateDocument> {
    await this.delay();
    const checkpoint = CHECKPOINTS.find((c) => c.id === locator.checkpointId);
    if (!checkpoint) throw new RepositoryError('NOT_FOUND', 'Reporting checkpoint not found.');
    const team = TEAMS.find((t) => t.id === locator.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');

    const existing = this.documents.get(docKey(locator.teamId, locator.sprintId, locator.checkpointId));
    if (existing) return structuredClone(existing);

    // No draft or submission exists for this checkpoint -> a Missing document.
    return {
      id: docKey(locator.teamId, locator.sprintId, locator.checkpointId),
      programmeId: PROGRAMME_ID,
      streamId: team.streamId,
      teamId: locator.teamId,
      sprintId: locator.sprintId,
      checkpointId: locator.checkpointId,
      state: 'MISSING',
      revision: 0,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: this.user.subject,
      payload: emptyPayload(),
    };
  }

  private checkConcurrency(key: string, incomingRevision: number, payload: UpdatePayload): void {
    const current = this.documents.get(key);
    const serverRevision = current?.revision ?? 0;

    // Armed demonstration OR an explicit token simulates another user's edit.
    const armed = this.conflictArmed.has(key) || payloadText(payload).includes('#conflict');
    if (armed) {
      this.conflictArmed.delete(key);
      if (current) {
        current.revision += 1;
        current.updatedBy = 'another.user';
        current.updatedAt = new Date().toISOString();
      }
      throw new RevisionConflictError({
        revision: (current?.revision ?? serverRevision) + 0,
        updatedAt: current?.updatedAt ?? new Date().toISOString(),
        updatedBy: 'another.user',
      });
    }

    if (incomingRevision !== serverRevision) {
      throw new RevisionConflictError({
        revision: serverRevision,
        updatedAt: current?.updatedAt ?? new Date().toISOString(),
        updatedBy: current?.updatedBy ?? 'another.user',
      });
    }
  }

  async saveDraft(input: SaveDraftInput): Promise<UpdateDocument> {
    await this.delay();
    const key = docKey(input.teamId, input.sprintId, input.checkpointId);
    this.assertCanEditDraft(input);
    this.assertNotSubmitted(key);
    this.failIfTriggered(input.payload);
    this.checkConcurrency(key, input.revision, input.payload);

    const existing = this.documents.get(key);
    const team = TEAMS.find((t) => t.id === input.teamId)!;
    const flags = deriveEnvelopeFlags(input.payload);
    const now = new Date().toISOString();
    // A reopened draft keeps REOPENED; otherwise editing makes it a DRAFT.
    const nextState: UpdateState = existing?.state === 'REOPENED' ? 'REOPENED' : 'DRAFT';

    const doc: UpdateDocument = {
      id: key,
      programmeId: PROGRAMME_ID,
      streamId: team.streamId,
      teamId: input.teamId,
      sprintId: input.sprintId,
      checkpointId: input.checkpointId,
      state: nextState,
      revision: (existing?.revision ?? 0) + 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: structuredClone(input.rag),
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: this.user.subject,
      submittedAt: existing?.submittedAt,
      payload: structuredClone(input.payload),
    };
    this.documents.set(key, doc);
    this.appendAudit({
      entityType: 'UPDATE',
      entityId: key,
      action: 'DRAFT_SAVED',
      previousVersion: existing?.revision,
      newVersion: doc.revision,
    });
    return structuredClone(doc);
  }

  async submit(input: SubmitInput): Promise<{ document: UpdateDocument; version: UpdateVersion }> {
    await this.delay();
    const key = docKey(input.teamId, input.sprintId, input.checkpointId);
    this.assertCanSubmit(input);
    this.assertNotSubmitted(key);
    this.failIfTriggered(input.payload);
    this.checkConcurrency(key, input.revision, input.payload);

    const existing = this.documents.get(key);
    const team = TEAMS.find((t) => t.id === input.teamId)!;
    const flags = deriveEnvelopeFlags(input.payload);
    const now = new Date().toISOString();

    // --- atomic: create immutable version + audit together ---
    const priorVersions = this.versions.filter(
      (v) => v.teamId === input.teamId && v.checkpointId === input.checkpointId,
    );
    const versionNumber = priorVersions.length + 1;
    const version: UpdateVersion = {
      id: `${input.teamId}-${input.sprintId}-${input.checkpointId}-v${versionNumber}`,
      teamId: input.teamId,
      sprintId: input.sprintId,
      checkpointId: input.checkpointId,
      versionNumber,
      submittedBy: this.user.subject,
      submittedAt: now,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: structuredClone(input.rag),
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      payload: structuredClone(input.payload),
    };

    const doc: UpdateDocument = {
      id: key,
      programmeId: PROGRAMME_ID,
      streamId: team.streamId,
      teamId: input.teamId,
      sprintId: input.sprintId,
      checkpointId: input.checkpointId,
      state: 'SUBMITTED',
      revision: (existing?.revision ?? 0) + 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: structuredClone(input.rag),
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: this.user.subject,
      submittedAt: now,
      payload: structuredClone(input.payload),
    };

    this.versions.push(version);
    this.documents.set(key, doc);
    this.appendAudit({
      entityType: 'VERSION',
      entityId: version.id,
      action: 'SUBMITTED',
      previousVersion: existing?.revision,
      newVersion: doc.revision,
    });

    return { document: structuredClone(doc), version: structuredClone(version) };
  }

  async reopen(input: ReopenInput): Promise<UpdateDocument> {
    await this.delay();
    if (!input.reason.trim()) {
      throw new RepositoryError('VALIDATION_FAILED', 'A reason is required to reopen a submitted update.');
    }
    const version = this.versions.find((v) => v.id === input.versionId);
    if (!version) throw new RepositoryError('NOT_FOUND', 'Submitted version not found.');
    // Reopen is an authorised action: assigned Team Lead only.
    if (!this.isAssigned(version.teamId) || !this.hasRole('TEAM_LEAD')) {
      throw new PermissionDeniedError('Only a Team Lead can reopen a submitted update.');
    }

    const key = docKey(version.teamId, version.sprintId, version.checkpointId);
    const existing = this.documents.get(key);
    const now = new Date().toISOString();
    const doc: UpdateDocument = {
      id: key,
      programmeId: PROGRAMME_ID,
      streamId: TEAMS.find((t) => t.id === version.teamId)!.streamId,
      teamId: version.teamId,
      sprintId: version.sprintId,
      checkpointId: version.checkpointId,
      state: 'REOPENED',
      revision: (existing?.revision ?? version.versionNumber) + 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: structuredClone(version.rag),
      hasBlocker: version.hasBlocker,
      hasLeadershipAsk: version.hasLeadershipAsk,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: this.user.subject,
      submittedAt: version.submittedAt,
      payload: structuredClone(version.payload),
    };
    this.documents.set(key, doc);
    this.appendAudit({
      entityType: 'UPDATE',
      entityId: key,
      action: 'REOPENED',
      previousVersion: version.versionNumber,
      newVersion: doc.revision,
      reason: input.reason.trim(),
    });
    return structuredClone(doc);
  }

  async getVersions(locator: UpdateLocator): Promise<UpdateVersion[]> {
    await this.delay();
    return this.versions
      .filter((v) => v.teamId === locator.teamId && v.checkpointId === locator.checkpointId)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((v) => structuredClone(v));
  }

  async getVersion(versionId: string): Promise<UpdateVersion> {
    await this.delay();
    const version = this.versions.find((v) => v.id === versionId);
    if (!version) throw new RepositoryError('NOT_FOUND', 'Submitted version not found.');
    return structuredClone(version);
  }

  async getAudit(entityId: string): Promise<AuditEvent[]> {
    await this.delay();
    return this.audit
      .filter((event) => event.entityId === entityId)
      .map((event) => structuredClone(event));
  }

  async getLeadershipSnapshot(
    _programmeId: string,
    sprintId: string,
    checkpointId: string,
  ): Promise<LeadershipSnapshot> {
    await this.delay();
    const sprint = SPRINTS.find((s) => s.id === sprintId);
    const checkpoint = CHECKPOINTS.find((c) => c.id === checkpointId);
    if (!sprint || !checkpoint) throw new RepositoryError('NOT_FOUND', 'Reporting cycle not found.');

    const streams: LeadershipStreamGroup[] = [...STREAMS]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((stream) => ({
        stream: structuredClone(stream),
        teams: TEAMS.filter((t) => t.streamId === stream.id && t.active)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map<LeadershipTeamCell>((team) => ({
            team: structuredClone(team),
            streamId: stream.id,
            resolved: this.resolveForLeadership(team.id, checkpoint.id),
          })),
      }));

    return {
      programme: structuredClone(PROGRAMME),
      sprint: structuredClone(sprint),
      checkpoint: structuredClone(checkpoint),
      streams,
    };
  }

  /** Resolve the content Leadership View should display for a team + checkpoint,
   *  including the derived STALE fallback to the latest earlier submission. */
  private resolveForLeadership(teamId: string, checkpointId: string): ResolvedUpdate {
    const checkpoint = CHECKPOINTS.find((c) => c.id === checkpointId)!;
    const currentDoc = this.documents.get(
      docKey(teamId, checkpoint.sprintId, checkpointId),
    );

    if (currentDoc && currentDoc.state === 'SUBMITTED') {
      return {
        cellState: 'SUBMITTED',
        rag: structuredClone(currentDoc.rag),
        hasBlocker: currentDoc.hasBlocker,
        hasLeadershipAsk: currentDoc.hasLeadershipAsk,
        payload: structuredClone(currentDoc.payload),
        sourceCheckpointId: checkpointId,
        sourceWeekNumber: checkpoint.weekNumber,
        submittedAt: currentDoc.submittedAt,
        updatedAt: currentDoc.updatedAt,
        isStale: false,
        isSubmittedEvidence: true,
      };
    }

    if (currentDoc && (currentDoc.state === 'DRAFT' || currentDoc.state === 'REOPENED')) {
      // Current-checkpoint work in progress — shown, but NOT leadership evidence.
      return {
        cellState: currentDoc.state,
        rag: structuredClone(currentDoc.rag),
        hasBlocker: currentDoc.hasBlocker,
        hasLeadershipAsk: currentDoc.hasLeadershipAsk,
        payload: structuredClone(currentDoc.payload),
        sourceCheckpointId: checkpointId,
        sourceWeekNumber: checkpoint.weekNumber,
        updatedAt: currentDoc.updatedAt,
        isStale: false,
        isSubmittedEvidence: false,
      };
    }

    // Nothing at the current checkpoint: look for the latest earlier submission.
    const earlier = this.latestEarlierSubmission(teamId, checkpoint.opensAt);
    if (earlier) {
      const earlierCheckpoint = CHECKPOINTS.find((c) => c.id === earlier.checkpointId)!;
      return {
        cellState: 'STALE',
        rag: structuredClone(earlier.rag),
        hasBlocker: earlier.hasBlocker,
        hasLeadershipAsk: earlier.hasLeadershipAsk,
        payload: structuredClone(earlier.payload),
        sourceCheckpointId: earlier.checkpointId,
        sourceWeekNumber: earlierCheckpoint.weekNumber,
        submittedAt: earlier.submittedAt,
        isStale: true,
        isSubmittedEvidence: false, // stale must NOT count as a current submission
      };
    }

    return {
      cellState: 'MISSING',
      rag: null, // no current evidence — never a false Green
      hasBlocker: false,
      hasLeadershipAsk: false,
      payload: null,
      sourceCheckpointId: null,
      sourceWeekNumber: null,
      isStale: false,
      isSubmittedEvidence: false,
    };
  }

  private latestEarlierSubmission(teamId: string, beforeOpensAt: string): UpdateVersion | undefined {
    const before = new Date(beforeOpensAt).getTime();
    return this.versions
      .filter((v) => v.teamId === teamId)
      .filter((v) => {
        const cp = CHECKPOINTS.find((c) => c.id === v.checkpointId);
        return cp ? new Date(cp.opensAt).getTime() < before : false;
      })
      .sort((a, b) => {
        const ca = CHECKPOINTS.find((c) => c.id === a.checkpointId)!;
        const cb = CHECKPOINTS.find((c) => c.id === b.checkpointId)!;
        return new Date(cb.opensAt).getTime() - new Date(ca.opensAt).getTime();
      })[0];
  }

  async recordDecision(input: DecisionInput): Promise<LeadershipDecision> {
    await this.delay();
    if (!this.hasRole('LEADERSHIP')) {
      throw new PermissionDeniedError('Only Programme Leadership can record a decision.');
    }
    const version = this.versions.find((v) => v.id === input.versionId);
    if (!version) throw new RepositoryError('NOT_FOUND', 'Submitted version not found.');
    const decision: LeadershipDecision = {
      id: this.nextId('decision'),
      updateVersionId: input.versionId,
      decision: input.decision.trim(),
      ownerSubject: this.user.subject,
      dueDate: input.dueDate,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };
    this.decisions.push(decision);
    this.appendAudit({
      entityType: 'DECISION',
      entityId: decision.id,
      action: 'DECISION_RECORDED',
    });
    return structuredClone(decision);
  }

  async getDecisions(versionId: string): Promise<LeadershipDecision[]> {
    await this.delay();
    return this.decisions
      .filter((d) => d.updateVersionId === versionId)
      .map((d) => structuredClone(d));
  }

  async export(input: ExportInput): Promise<ExportSnapshot> {
    await this.delay();
    const snapshot = await this.getLeadershipSnapshot(
      input.programmeId,
      input.sprintId,
      input.checkpointId,
    );
    // Export EXACTLY the filtered population, using the same domain semantics
    // as Leadership View (review finding: export must match the on-screen set).
    const filteredGroups = applyFilters(snapshot, input.filters);
    const records = flattenTeams(filteredGroups).map((cell) => ({
      teamId: cell.team.id,
      teamName: cell.team.name,
      streamId: cell.streamId,
      state: cell.resolved.cellState,
      isSubmittedEvidence: cell.resolved.isSubmittedEvidence,
      rag: cell.resolved.rag,
      payload: cell.resolved.payload,
      sourceCheckpointId: cell.resolved.sourceCheckpointId,
    }));
    return {
      programme: snapshot.programme.name,
      sprintId: input.sprintId,
      checkpointId: input.checkpointId,
      reportingPeriodLabel: `${snapshot.sprint.label} · Week ${snapshot.checkpoint.weekNumber}`,
      filters: input.filters,
      recordCount: records.length,
      exportedAt: new Date().toISOString(),
      records,
    };
  }

  private appendAudit(event: {
    entityType: AuditEvent['entityType'];
    entityId: string;
    action: AuditEvent['action'];
    previousVersion?: number;
    newVersion?: number;
    reason?: string;
  }): void {
    this.audit.push({
      id: this.nextId('audit'),
      programmeId: PROGRAMME_ID,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actorSubject: this.user.subject,
      timestamp: new Date().toISOString(),
      previousVersion: event.previousVersion,
      newVersion: event.newVersion,
      reason: event.reason,
      correlationId: this.nextId('corr'),
    });
  }
}

export function createMockRepository(options?: MockRepositoryOptions): Repository {
  return new MockRepository(options);
}
