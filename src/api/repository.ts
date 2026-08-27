/**
 * Vendor-neutral repository interface.
 *
 * The UI depends ONLY on this contract — never on localStorage, HTTP, or a
 * specific database (design.md §7, task 2.8). Phase A provides an in-memory
 * mock implementation; Phase B will provide an HTTP implementation of the SAME
 * interface behind the same query hooks, with no UI changes.
 */
import type {
  HierarchyTree,
  ReportingCheckpoint,
  Sprint,
} from '../domain/hierarchy';
import type {
  LeadershipFilters,
  LeadershipSnapshot,
} from '../domain/leadership';
import type {
  AuditEvent,
  LeadershipDecision,
  RagStatuses,
  UpdateDocument,
  UpdatePayload,
  UpdateVersion,
} from '../domain/update';

export type Role =
  | 'CONTRIBUTOR'
  | 'TEAM_LEAD'
  | 'LEADERSHIP'
  | 'ADMIN'
  | 'AUDITOR';

/** Local-account lifecycle status (Phase 8, design.md §5a). */
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

export interface CurrentUser {
  subject: string;
  /** Account email (also the login identifier). */
  email: string;
  displayName: string;
  initials: string;
  roleLabel: string;
  /** Account lifecycle status; only ACTIVE users may reach programme data. */
  status: AccountStatus;
  /**
   * The single programme this principal is assigned to (null until assigned).
   * A LEADERSHIP/ADMIN/AUDITOR role applies only to this programme (Phase 8).
   */
  programmeId: string | null;
  roles: Role[];
  /** Teams the user may edit/submit. */
  assignedTeamIds: string[];
  /** Whether the user can view the whole programme in Leadership View. */
  canViewAll: boolean;
}

export interface UpdateLocator {
  teamId: string;
  sprintId: string;
  checkpointId: string;
}

/** Payload + RAG + revision sent on every draft save (design.md §6). */
export interface SaveDraftInput extends UpdateLocator {
  revision: number;
  rag: RagStatuses;
  payload: UpdatePayload;
}

export interface SubmitInput extends UpdateLocator {
  revision: number;
  rag: RagStatuses;
  payload: UpdatePayload;
}

export interface ReopenInput {
  versionId: string;
  reason: string;
}

export interface DecisionInput {
  versionId: string;
  decision: string;
  dueDate?: string;
}

export interface ExportInput {
  programmeId: string;
  sprintId: string;
  checkpointId: string;
  /** The active Leadership View filters — the export uses identical semantics. */
  filters: LeadershipFilters;
}

export interface ExportSnapshot {
  programme: string;
  sprintId: string;
  checkpointId: string;
  reportingPeriodLabel: string;
  /** The filters that produced this export. */
  filters: LeadershipFilters;
  /** Number of records after filtering. */
  recordCount: number;
  exportedAt: string;
  records: Array<{
    teamId: string;
    teamName: string;
    streamId: string;
    state: string;
    isSubmittedEvidence: boolean;
    /** null when there is no current evidence (Missing). */
    rag: RagStatuses | null;
    payload: UpdatePayload | null;
    sourceCheckpointId: string | null;
  }>;
}

export interface Repository {
  // Identity / permissions
  getCurrentUser(): Promise<CurrentUser>;

  // Hierarchy + reporting cycle (read)
  getHierarchy(programmeId: string): Promise<HierarchyTree>;
  getSprints(programmeId: string): Promise<Sprint[]>;
  getCheckpoints(sprintId: string): Promise<ReportingCheckpoint[]>;

  // Team Update (read/write)
  getUpdate(locator: UpdateLocator): Promise<UpdateDocument>;
  saveDraft(input: SaveDraftInput): Promise<UpdateDocument>;
  submit(input: SubmitInput): Promise<{ document: UpdateDocument; version: UpdateVersion }>;
  reopen(input: ReopenInput): Promise<UpdateDocument>;

  // Versions + audit
  getVersions(locator: UpdateLocator): Promise<UpdateVersion[]>;
  getVersion(versionId: string): Promise<UpdateVersion>;
  getAudit(entityId: string): Promise<AuditEvent[]>;

  // Leadership
  getLeadershipSnapshot(
    programmeId: string,
    sprintId: string,
    checkpointId: string,
  ): Promise<LeadershipSnapshot>;
  recordDecision(input: DecisionInput): Promise<LeadershipDecision>;
  getDecisions(versionId: string): Promise<LeadershipDecision[]>;
  export(input: ExportInput): Promise<ExportSnapshot>;
}

/** Stable error codes surfaced to the UI (design.md §6 error envelope). */
export type RepositoryErrorCode =
  | 'DRAFT_REVISION_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'WINDOW_CLOSED'
  | 'ALREADY_SUBMITTED'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'SAVE_FAILED'
  | 'VALIDATION_FAILED';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly correlationId: string;

  constructor(code: RepositoryErrorCode, message: string, correlationId = generateCorrelationId()) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.correlationId = correlationId;
  }
}

/** Thrown when a draft save/submit uses a stale revision (never overwrites). */
export class RevisionConflictError extends RepositoryError {
  readonly serverRevision: number;
  readonly serverUpdatedAt: string;
  readonly serverUpdatedBy: string;

  constructor(server: { revision: number; updatedAt: string; updatedBy: string }) {
    super(
      'DRAFT_REVISION_CONFLICT',
      'This draft changed after you opened it. Review the latest version before saving.',
    );
    this.name = 'RevisionConflictError';
    this.serverRevision = server.revision;
    this.serverUpdatedAt = server.updatedAt;
    this.serverUpdatedBy = server.updatedBy;
  }
}

export class PermissionDeniedError extends RepositoryError {
  constructor(message = 'You do not have permission to edit this team update.') {
    super('PERMISSION_DENIED', message);
    this.name = 'PermissionDeniedError';
  }
}

function generateCorrelationId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}
