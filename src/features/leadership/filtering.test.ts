import { beforeEach, describe, expect, it } from 'vitest';
import { MockRepository } from '../../api/mockRepository';
import { PROGRAMME_ID } from '../../config';
import { applyFilters, computeSummary, flattenTeams, matchesFilters } from './filtering';
import { DEFAULT_LEADERSHIP_FILTERS } from '../../domain/leadership';
import type { LeadershipSnapshot } from '../../domain/leadership';

let snapshot: LeadershipSnapshot;

beforeEach(async () => {
  const repo = new MockRepository({ latencyMs: 0 });
  snapshot = await repo.getLeadershipSnapshot(PROGRAMME_ID, 'S14', 'C14-1');
});

describe('applyFilters', () => {
  it('returns all streams with the default filters', () => {
    const groups = applyFilters(snapshot, DEFAULT_LEADERSHIP_FILTERS);
    expect(flattenTeams(groups)).toHaveLength(8);
  });

  it('filters by stream and drops empty streams', () => {
    const groups = applyFilters(snapshot, { ...DEFAULT_LEADERSHIP_FILTERS, streamId: 'MMM' });
    expect(groups).toHaveLength(1);
    expect(flattenTeams(groups)).toHaveLength(2);
  });

  it('filters by update state', () => {
    const groups = applyFilters(snapshot, { ...DEFAULT_LEADERSHIP_FILTERS, state: 'DRAFT' });
    const teams = flattenTeams(groups);
    expect(teams.length).toBeGreaterThan(0);
    expect(teams.every((t) => t.resolved.cellState === 'DRAFT')).toBe(true);
  });

  it('filters by RAG across any dimension', () => {
    const groups = applyFilters(snapshot, { ...DEFAULT_LEADERSHIP_FILTERS, rag: 'RED' });
    const teams = flattenTeams(groups);
    expect(
      teams.every((t) => t.resolved.rag && Object.values(t.resolved.rag).includes('RED')),
    ).toBe(true);
  });

  it('can produce an empty result', () => {
    const groups = applyFilters(snapshot, {
      streamId: 'Visa',
      rag: 'RED',
      state: 'MISSING',
    });
    expect(flattenTeams(groups)).toHaveLength(0);
  });
});

describe('matchesFilters', () => {
  it('matches when all filters are ALL', () => {
    const cell = snapshot.streams[0]!.teams[0]!;
    expect(matchesFilters(cell, DEFAULT_LEADERSHIP_FILTERS)).toBe(true);
  });
});

describe('computeSummary', () => {
  it('counts submitted, draft/missing and asks against the filtered set', () => {
    const groups = applyFilters(snapshot, DEFAULT_LEADERSHIP_FILTERS);
    const summary = computeSummary(groups, 'Sprint 14 · Week 1');
    // Week 1: 6 submitted, 2 drafts, 3 asks (matches the seeded prototype numbers).
    expect(summary.teamCount).toBe(8);
    expect(summary.submittedCount).toBe(6);
    expect(summary.draftOrMissingCount).toBe(2);
    expect(summary.leadershipAskCount).toBe(3);
    expect(summary.reportingPeriodLabel).toBe('Sprint 14 · Week 1');
  });
});
