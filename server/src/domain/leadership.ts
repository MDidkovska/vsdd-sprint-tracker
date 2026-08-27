/**
 * Leadership View projection shapes for the PoC backend (task 7.7).
 *
 * Leadership View is a *projection* of submitted Team Update data — it never
 * stores a second copy (design.md §1). These types MIRROR the frontend domain
 * contract (`src/domain/leadership.ts`) and the OpenAPI component schemas
 * (`LeadershipFilters`, `ResolvedUpdate`, `LeadershipTeamCell`,
 * `LeadershipStreamGroup`, `LeadershipSnapshot`, `ProgrammeSummary`,
 * `ReportingSummary`) so a snapshot produced by this backend is structurally
 * identical to what the frontend mock repository already returns. The backend
 * is a separate package, so the shapes are re-declared here rather than
 * imported.
 *
 * `STALE` is a *derived* presentation state, never stored (design.md §5): when
 * the current checkpoint has no submitted version we surface the latest earlier
 * submission and mark it STALE. A STALE cell must NOT count as current
 * submitted evidence (R12.4).
 */
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from './hierarchy.js';
import type { RagStatuses, RagValue, UpdatePayload, UpdateState } from './documents.js';

/** Presentation state used by Leadership View cells (adds derived STALE). */
export type LeadershipCellState = UpdateState | 'STALE';

/**
 * The update content resolved for a given team + checkpoint, including the
 * derived STALE fallback. `rag`/`payload` are null when there is no current
 * evidence (Missing) — never a false Green (R12.4).
 */
export interface ResolvedUpdate {
  cellState: LeadershipCellState;
  /** null when there is no current evidence (Missing) — never a false Green. */
  rag: RagStatuses | null;
  hasBlocker: boolean;
  hasLeadershipAsk: boolean;
  /** null only when nothing exists at all (Missing). */
  payload: UpdatePayload | null;
  /** checkpoint the displayed content actually came from (for Stale labelling). */
  sourceCheckpointId: string | null;
  sourceWeekNumber: 1 | 2 | null;
  submittedAt?: string;
  updatedAt?: string;
  isStale: boolean;
  /** true when the content is a submitted, immutable version (leadership evidence). */
  isSubmittedEvidence: boolean;
}

export interface LeadershipTeamCell {
  team: Team;
  streamId: string;
  resolved: ResolvedUpdate;
}

export interface LeadershipStreamGroup {
  stream: Stream;
  teams: LeadershipTeamCell[];
}

export interface LeadershipSnapshot {
  programme: Programme;
  sprint: Sprint;
  checkpoint: ReportingCheckpoint;
  streams: LeadershipStreamGroup[];
}

export type RagFilter = 'ALL' | RagValue;
export type StateFilter = 'ALL' | LeadershipCellState;

export interface LeadershipFilters {
  streamId: string; // 'ALL' or a stream id
  rag: RagFilter;
  state: StateFilter;
}

export const DEFAULT_LEADERSHIP_FILTERS: LeadershipFilters = {
  streamId: 'ALL',
  rag: 'ALL',
  state: 'ALL',
};

export interface ProgrammeSummary {
  teamCount: number;
  submittedCount: number;
  draftOrMissingCount: number;
  leadershipAskCount: number;
  reportingPeriodLabel: string;
}

/**
 * The reporting-summary response envelope (OpenAPI `ReportingSummary`): the
 * programme summary counts, the filtered leadership snapshot and the resolved
 * filters that produced them.
 */
export interface ReportingSummary {
  summary: ProgrammeSummary;
  snapshot: LeadershipSnapshot;
  filters: LeadershipFilters;
}
