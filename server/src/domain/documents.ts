/**
 * Document-oriented domain shapes for the PoC backend.
 *
 * These types intentionally MIRROR the frontend domain contract
 * (`src/domain/update.ts`) and the vendor-neutral persistence model
 * (`src/api/persistence.ts`). The backend is a separate package with its own
 * module system, so the shapes are re-declared here rather than imported — but
 * they must stay structurally identical to the frontend so a document written
 * by this adapter round-trips through the same repository contract the Phase A
 * mock already implements (design.md §4a / §4b).
 *
 * Every stored document follows the §4a aggregate: a stable, indexable *query
 * envelope* plus a flexible, versioned *payload*. `schemaVersion` and
 * `revision` (the optimistic-concurrency / ETag token) always live on the
 * envelope, never buried in the payload.
 */

/** Current document/payload contract version (matches frontend config.ts). */
export const CURRENT_SCHEMA_VERSION = 1;

/** Three independent RAG dimensions (requirements.md R4). */
export type RagValue = 'GREEN' | 'AMBER' | 'RED';

export interface RagStatuses {
  business: RagValue;
  delivery: RagValue;
  release: RagValue;
}

/**
 * Stored document state. `STALE` is NOT stored — it is derived in Leadership
 * View — so it is deliberately absent from this persisted union.
 */
export type UpdateState = 'MISSING' | 'DRAFT' | 'SUBMITTED' | 'REOPENED';

export type ExceptionType = 'RISK' | 'ISSUE' | 'BLOCKER';
export type ExceptionStatus = 'OPEN' | 'RESOLVED';

export interface ExceptionItem {
  id: string;
  type: ExceptionType;
  impact: string;
  owner: string;
  dueDate: string;
  decisionSupport: string;
  status: ExceptionStatus;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface GoalsAndCommitments {
  business: string;
  technicalTesting: string;
  sprintCommitment: string;
  nextWeekCommitment: string;
}

export interface QualityEvidence {
  planned: number;
  executed: number;
  passed: number;
  openCritical: number;
  blocked: number;
  automationPercent: number;
}

export interface AiValue {
  useCase: string;
  measurableBenefit: string;
  humanValidation: string;
  nextExperimentConstraint: string;
}

/** Flexible, versioned payload (design.md §4a). */
export interface UpdatePayload {
  goals: GoalsAndCommitments;
  qualityEvidence: QualityEvidence;
  achievements: string;
  aiValue: AiValue;
  exceptions: ExceptionItem[];
  leadershipAsk: string;
  statusRationale?: string;
  metricsNote?: string;
}

/**
 * The mutable draft aggregate for a team + checkpoint (`updates` collection).
 * `id` is the deterministic aggregate key `${teamId}|${sprintId}|${checkpointId}`.
 */
export interface UpdateDocument {
  // --- stable query envelope ---
  id: string;
  programmeId: string;
  streamId: string;
  teamId: string;
  sprintId: string;
  checkpointId: string;
  state: UpdateState;
  revision: number;
  schemaVersion: number;
  rag: RagStatuses;
  hasBlocker: boolean;
  hasLeadershipAsk: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  submittedAt?: string;
  // --- flexible payload ---
  payload: UpdatePayload;
}

/** Immutable submitted snapshot (`updateVersions` collection, append-only). */
export interface UpdateVersion {
  id: string;
  programmeId: string;
  streamId: string;
  teamId: string;
  sprintId: string;
  checkpointId: string;
  versionNumber: number;
  submittedBy: string;
  submittedAt: string;
  schemaVersion: number;
  rag: RagStatuses;
  hasBlocker: boolean;
  hasLeadershipAsk: boolean;
  payload: UpdatePayload;
}

/** Lifecycle of a recorded leadership decision. */
export type DecisionStatus = 'OPEN' | 'CLOSED';

/**
 * A leadership decision recorded against a specific immutable submitted version
 * (`decisions` collection, append-only). Recording a decision NEVER mutates the
 * referenced {@link UpdateVersion} or the team's original leadership ask
 * (R10.3) — the decision is a separate append-only document. The shape mirrors
 * the frontend domain type and the OpenAPI `LeadershipDecision` schema exactly.
 */
export interface LeadershipDecision {
  id: string;
  updateVersionId: string;
  decision: string;
  ownerSubject: string;
  dueDate?: string;
  status: DecisionStatus;
  createdAt: string;
}

export type AuditAction =
  | 'DRAFT_SAVED'
  | 'SUBMITTED'
  | 'REOPENED'
  | 'DECISION_RECORDED'
  | 'EXPORT_CREATED'
  // --- local-account / auth actions (Phase 8, design.md §5a) ---
  | 'USER_REGISTERED'
  | 'USER_APPROVED'
  | 'USER_REJECTED'
  | 'ASSIGNMENT_CHANGED'
  | 'USER_SUSPENDED'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'ADMIN_BOOTSTRAPPED'
  // --- programme administration actions (Phase 9, task 9.5) ---
  /** A stream or team was created or updated (hierarchy admin, R17). */
  | 'HIERARCHY_CHANGED'
  /** A sprint was created together with its two weekly checkpoints (R2.1). */
  | 'SPRINT_CREATED'
  /** A reporting checkpoint changed (set current / close / reopen window, R2.2/R2.3). */
  | 'CHECKPOINT_CHANGED';

export type AuditEntityType =
  | 'UPDATE'
  | 'VERSION'
  | 'DECISION'
  | 'EXPORT'
  | 'USER'
  | 'SESSION'
  // --- reference/config entities administered in Phase 9 (task 9.5) ---
  | 'STREAM'
  | 'TEAM'
  | 'SPRINT'
  | 'CHECKPOINT';

/**
 * Append-only audit document (`auditEvents` collection).
 *
 * `entityId` still points at the specific entity the event is about (the
 * submitted version, the mutable draft aggregate, the decision, or — for an
 * export — the programme). `aggregateId` is the STABLE update-aggregate key
 * `${teamId}|${sprintId}|${checkpointId}` (see {@link docKey}) shared by every
 * event in one update's lifecycle — submit, reopen, resubmit and
 * leadership-decision — so the audit endpoint can return a single unified
 * history for that update regardless of which entity id each event carries. For
 * events not tied to an update aggregate (e.g. `EXPORT_CREATED`) `aggregateId`
 * carries the relevant programme id instead, and never collides with a real
 * update-aggregate key.
 */
export interface AuditEvent {
  id: string;
  programmeId: string;
  /**
   * Stable update-aggregate key shared across an update's whole lifecycle.
   * For non-update events (export) this is the programme id.
   */
  aggregateId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  actorSubject: string;
  timestamp: string;
  previousVersion?: number;
  newVersion?: number;
  reason?: string;
  /**
   * A short, NON-SENSITIVE summary of the request context for an event (e.g.
   * the export filter selection). Must never contain user-authored update
   * content — only stable ids / enum selections (design.md §14, R15).
   */
  filterSummary?: string;
  correlationId: string;
}

/**
 * Deterministic aggregate key for the mutable draft document. Identical to the
 * frontend `docKey` helper so keys match across the boundary.
 */
export function docKey(teamId: string, sprintId: string, checkpointId: string): string {
  return `${teamId}|${sprintId}|${checkpointId}`;
}

/** Derive the denormalised envelope filter flags from payload content. */
export function deriveEnvelopeFlags(payload: UpdatePayload): {
  hasBlocker: boolean;
  hasLeadershipAsk: boolean;
} {
  const hasBlocker = payload.exceptions.some(
    (item) => item.type === 'BLOCKER' && item.status === 'OPEN',
  );
  const ask = payload.leadershipAsk.trim();
  const hasLeadershipAsk = ask.length > 0 && ask.toLowerCase() !== 'none';
  return { hasBlocker, hasLeadershipAsk };
}
