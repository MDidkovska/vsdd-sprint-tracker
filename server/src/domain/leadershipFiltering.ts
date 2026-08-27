/**
 * Pure leadership filtering + summary semantics for the PoC backend (task 7.7).
 *
 * These MIRROR the frontend domain functions (`src/domain/leadershipFiltering.ts`)
 * so the server projection filters and counts exactly as Leadership View and the
 * export path do (R13.1–R13.3). Keeping this pure (no I/O, no MongoDB) means the
 * filter predicates and summary calculations are unit-testable in isolation and
 * reused by the leadership summary service.
 */
import type {
  LeadershipFilters,
  LeadershipSnapshot,
  LeadershipStreamGroup,
  LeadershipTeamCell,
  ProgrammeSummary,
} from './leadership.js';

/** Does a team cell match the active filters? */
export function matchesFilters(
  cell: LeadershipTeamCell,
  filters: LeadershipFilters,
): boolean {
  if (filters.streamId !== 'ALL' && cell.streamId !== filters.streamId) return false;
  if (filters.state !== 'ALL' && cell.resolved.cellState !== filters.state) return false;
  if (filters.rag !== 'ALL') {
    // Missing has no current RAG and can never match a RAG filter (no false Green).
    const rag = cell.resolved.rag;
    if (!rag) return false;
    if (
      rag.business !== filters.rag &&
      rag.delivery !== filters.rag &&
      rag.release !== filters.rag
    ) {
      return false;
    }
  }
  return true;
}

/** Filter the snapshot, dropping streams that end up with no visible teams. */
export function applyFilters(
  snapshot: LeadershipSnapshot,
  filters: LeadershipFilters,
): LeadershipStreamGroup[] {
  return snapshot.streams
    .map((group) => ({
      ...group,
      teams: group.teams.filter((cell) => matchesFilters(cell, filters)),
    }))
    .filter((group) => group.teams.length > 0);
}

export function flattenTeams(groups: LeadershipStreamGroup[]): LeadershipTeamCell[] {
  return groups.flatMap((group) => group.teams);
}

/** Programme summary computed against the filtered population (R13.2/R13.3). */
export function computeSummary(
  groups: LeadershipStreamGroup[],
  reportingPeriodLabel: string,
): ProgrammeSummary {
  const teams = flattenTeams(groups);
  const submittedCount = teams.filter((t) => t.resolved.isSubmittedEvidence).length;
  const draftOrMissingCount = teams.filter((t) => !t.resolved.isSubmittedEvidence).length;
  const leadershipAskCount = teams.filter((t) => t.resolved.hasLeadershipAsk).length;
  return {
    teamCount: teams.length,
    submittedCount,
    draftOrMissingCount,
    leadershipAskCount,
    reportingPeriodLabel,
  };
}
