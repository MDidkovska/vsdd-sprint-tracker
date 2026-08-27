/**
 * Unit tests for the pure leadership filtering + summary semantics (task 7.7).
 *
 * These exercise the filter predicates and summary calculations in isolation
 * (no I/O), mirroring the frontend domain tests so both sides agree on the
 * R13.1–R13.3 behaviour: stream/RAG/state filtering, summary counts recomputed
 * against the filtered population, and the empty-result case (R13.4).
 */
import { describe, expect, it } from 'vitest';
import type { RagStatuses } from './documents.js';
import type {
  LeadershipCellState,
  LeadershipSnapshot,
  LeadershipTeamCell,
  ResolvedUpdate,
} from './leadership.js';
import { applyFilters, computeSummary, flattenTeams, matchesFilters } from './leadershipFiltering.js';

const GREEN: RagStatuses = { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' };
const RED_MIX: RagStatuses = { business: 'RED', delivery: 'AMBER', release: 'GREEN' };
const AMBER: RagStatuses = { business: 'AMBER', delivery: 'AMBER', release: 'AMBER' };

function resolved(overrides: Partial<ResolvedUpdate> = {}): ResolvedUpdate {
  return {
    cellState: 'SUBMITTED',
    rag: GREEN,
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: null,
    sourceCheckpointId: 'C14-1',
    sourceWeekNumber: 1,
    isStale: false,
    isSubmittedEvidence: true,
    ...overrides,
  };
}

function cell(
  teamId: string,
  streamId: string,
  resolvedOverrides: Partial<ResolvedUpdate> = {},
): LeadershipTeamCell {
  return {
    team: { id: teamId, streamId, name: teamId, sortOrder: 1, active: true },
    streamId,
    resolved: resolved(resolvedOverrides),
  };
}

function stateCell(teamId: string, streamId: string, state: LeadershipCellState): LeadershipTeamCell {
  if (state === 'SUBMITTED') return cell(teamId, streamId);
  if (state === 'MISSING') {
    return cell(teamId, streamId, {
      cellState: 'MISSING',
      rag: null,
      payload: null,
      sourceCheckpointId: null,
      sourceWeekNumber: null,
      isSubmittedEvidence: false,
    });
  }
  if (state === 'STALE') {
    return cell(teamId, streamId, { cellState: 'STALE', isStale: true, isSubmittedEvidence: false });
  }
  // DRAFT or REOPENED
  return cell(teamId, streamId, { cellState: state, isSubmittedEvidence: false });
}

function snapshot(): LeadershipSnapshot {
  return {
    programme: { id: 'vsdd', name: 'VSDD', active: true },
    sprint: { id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT' },
    checkpoint: { id: 'C14-1', sprintId: 'S14', weekNumber: 1, opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT' },
    streams: [
      {
        stream: { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true },
        teams: [
          cell('mmm-a', 'MMM', { rag: GREEN, hasLeadershipAsk: true }),
          stateCell('mmm-b', 'MMM', 'DRAFT'),
        ],
      },
      {
        stream: { id: 'OAH', programmeId: 'vsdd', name: 'OAH', sortOrder: 2, active: true },
        teams: [
          cell('oah-ils', 'OAH', { rag: RED_MIX }),
          stateCell('oah-sales', 'OAH', 'MISSING'),
        ],
      },
      {
        stream: { id: 'Visa', programmeId: 'vsdd', name: 'Visa', sortOrder: 3, active: true },
        teams: [stateCell('visa', 'Visa', 'STALE')],
      },
    ],
  };
}

describe('matchesFilters', () => {
  it('matches everything when all filters are ALL', () => {
    const c = cell('mmm-a', 'MMM', { rag: AMBER });
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'ALL', state: 'ALL' })).toBe(true);
  });

  it('filters by stream id', () => {
    const c = cell('mmm-a', 'MMM');
    expect(matchesFilters(c, { streamId: 'MMM', rag: 'ALL', state: 'ALL' })).toBe(true);
    expect(matchesFilters(c, { streamId: 'OAH', rag: 'ALL', state: 'ALL' })).toBe(false);
  });

  it('matches a RAG filter against any of the three dimensions', () => {
    const c = cell('oah-ils', 'OAH', { rag: RED_MIX });
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'RED', state: 'ALL' })).toBe(true);
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'AMBER', state: 'ALL' })).toBe(true);
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'GREEN', state: 'ALL' })).toBe(true);
  });

  it('never matches a RAG filter for a Missing cell (no false Green)', () => {
    const c = stateCell('oah-sales', 'OAH', 'MISSING');
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'GREEN', state: 'ALL' })).toBe(false);
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'RED', state: 'ALL' })).toBe(false);
  });

  it('filters by update state', () => {
    const c = stateCell('visa', 'Visa', 'STALE');
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'ALL', state: 'STALE' })).toBe(true);
    expect(matchesFilters(c, { streamId: 'ALL', rag: 'ALL', state: 'SUBMITTED' })).toBe(false);
  });
});

describe('applyFilters', () => {
  it('drops streams that end up with no visible teams', () => {
    const groups = applyFilters(snapshot(), { streamId: 'ALL', rag: 'ALL', state: 'SUBMITTED' });
    // Only mmm-a and oah-ils are SUBMITTED, so MMM + OAH survive; Visa (STALE) drops.
    expect(groups.map((g) => g.stream.id)).toEqual(['MMM', 'OAH']);
    expect(flattenTeams(groups).map((t) => t.team.id)).toEqual(['mmm-a', 'oah-ils']);
  });

  it('returns an empty projection when nothing matches', () => {
    const groups = applyFilters(snapshot(), { streamId: 'GRMB', rag: 'ALL', state: 'ALL' });
    expect(groups).toEqual([]);
  });
});

describe('computeSummary', () => {
  it('counts submitted, draft/missing and asks against the full population', () => {
    const groups = applyFilters(snapshot(), { streamId: 'ALL', rag: 'ALL', state: 'ALL' });
    const summary = computeSummary(groups, 'Sprint 14 · Week 1');
    expect(summary.teamCount).toBe(5);
    // mmm-a + oah-ils are submitted evidence; mmm-b/oah-sales/visa are not.
    expect(summary.submittedCount).toBe(2);
    expect(summary.draftOrMissingCount).toBe(3);
    expect(summary.leadershipAskCount).toBe(1);
    expect(summary.reportingPeriodLabel).toBe('Sprint 14 · Week 1');
  });

  it('recalculates against the filtered population (R13.2)', () => {
    const groups = applyFilters(snapshot(), { streamId: 'ALL', rag: 'ALL', state: 'MISSING' });
    const summary = computeSummary(groups, 'Sprint 14 · Week 1');
    expect(summary.teamCount).toBe(1);
    expect(summary.submittedCount).toBe(0);
    expect(summary.draftOrMissingCount).toBe(1);
    expect(summary.leadershipAskCount).toBe(0);
  });
});
