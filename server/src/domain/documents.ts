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

export type AuditAction =
  | 'DRAFT_SAVED'
  | 'SUBMITTED'
  | 'REOPENED'
  | 'DECISION_RECORDED';

/** Append-only audit document (`auditEvents` collection). */
export interface AuditEvent {
  id: string;
  programmeId: string;
  entityType: 'UPDATE' | 'VERSION' | 'DECISION';
  entityId: string;
  action: AuditAction;
  actorSubject: string;
  timestamp: string;
  previousVersion?: number;
  newVersion?: number;
  reason?: string;
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
