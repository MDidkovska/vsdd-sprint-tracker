/**
 * Core update domain types.
 *
 * The update aggregate follows design.md §4a: a stable query envelope plus a
 * flexible, versioned payload. Submitted versions are immutable snapshots.
 */

/** Three independent RAG dimensions (requirements.md R4). */
export type RagValue = 'GREEN' | 'AMBER' | 'RED';

export interface RagStatuses {
  business: RagValue; // Business outcome
  delivery: RagValue; // Test delivery
  release: RagValue; // Release confidence
}

export type RagDimension = keyof RagStatuses;

/**
 * Stored document state. `STALE` is NOT a stored state — it is derived in the
 * Leadership View when the current checkpoint has no submitted version and the
 * latest available submission comes from an earlier checkpoint.
 */
export type UpdateState = 'MISSING' | 'DRAFT' | 'SUBMITTED' | 'REOPENED';

/** Presentation state used by Leadership View cells (adds derived STALE). */
export type LeadershipCellState = UpdateState | 'STALE';

export type ExceptionType = 'RISK' | 'ISSUE' | 'BLOCKER';
export type ExceptionStatus = 'OPEN' | 'RESOLVED';

export interface ExceptionItem {
  id: string;
  type: ExceptionType;
  impact: string; // Business / release impact
  owner: string;
  dueDate: string; // ISO date
  decisionSupport: string; // Decision / support needed
  status: ExceptionStatus;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface GoalsAndCommitments {
  business: string; // Business goal
  technicalTesting: string; // Technical / testing goal
  sprintCommitment: string; // Sprint commitment
  nextWeekCommitment: string; // Next week commitment
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
  /** Required only when a RAG is Amber/Red and no exception is present (R4.3). */
  statusRationale?: string;
  /** Required only when a metric inconsistency is submitted anyway (R6.3). */
  metricsNote?: string;
}

/** The current, mutable update aggregate (draft) for a team + checkpoint. */
export interface UpdateDocument {
  // --- stable query envelope ---
  id: string; // `${teamId}|${sprintId}|${checkpointId}`
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

/** Immutable submitted snapshot (design.md §4). */
export interface UpdateVersion {
  id: string;
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

export interface LeadershipDecision {
  id: string;
  updateVersionId: string;
  decision: string;
  ownerSubject: string;
  dueDate?: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

/** Human-readable labels. Colour never carries meaning alone (R4.2). */
export const RAG_LABELS: Record<RagValue, string> = {
  GREEN: 'Green',
  AMBER: 'Amber',
  RED: 'Red',
};

export const STATE_LABELS: Record<LeadershipCellState, string> = {
  MISSING: 'Missing',
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  REOPENED: 'Reopened',
  STALE: 'Stale',
};

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  RISK: 'Risk',
  ISSUE: 'Issue',
  BLOCKER: 'Blocker',
};

/** States that count as submitted leadership evidence. */
export function isSubmittedEvidence(state: LeadershipCellState): boolean {
  return state === 'SUBMITTED';
}
