/**
 * Leadership View projection types. Leadership View is a *projection* of
 * submitted Team Update data — it never stores a second copy (design.md §1).
 */
import type { Programme, ReportingCheckpoint, Sprint, Stream, Team } from './hierarchy';
import type { LeadershipCellState, RagStatuses, UpdatePayload } from './update';

/**
 * The update content resolved for a given team + checkpoint, including the
 * derived STALE fallback: when the current checkpoint has no submitted version,
 * we surface the latest available submission from an earlier checkpoint and
 * mark it STALE (it must NOT count as a current submission).
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

export type RagFilter = 'ALL' | RagStatuses[keyof RagStatuses];
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
