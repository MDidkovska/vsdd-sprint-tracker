/**
 * Pure field-level comparison tests (task 9.4). Mirror of the backend logic:
 * direction by version number, numeric-zero preservation, line-break-preserving
 * string diff, and exception reconciliation by stable id.
 */
import { describe, expect, it } from 'vitest';
import { compareVersions } from './versionComparison';
import type { ExceptionItem, UpdatePayload, UpdateVersion } from './update';

function payload(over: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: {
      business: 'Ship the pricing API',
      technicalTesting: 'Cover edge cases',
      sprintCommitment: 'Complete auth',
      nextWeekCommitment: 'Start reporting',
    },
    qualityEvidence: {
      planned: 20,
      executed: 15,
      passed: 12,
      openCritical: 0,
      blocked: 0,
      automationPercent: 40,
    },
    achievements: 'Line one\nLine two',
    aiValue: {
      useCase: 'Summarise defects',
      measurableBenefit: '2h saved',
      humanValidation: 'Lead reviewed',
      nextExperimentConstraint: 'None',
    },
    exceptions: [],
    leadershipAsk: 'None',
    ...over,
  };
}

function version(versionNumber: number, over: Partial<UpdateVersion> = {}): UpdateVersion {
  return {
    id: `v${versionNumber}`,
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber,
    submittedBy: 'lead@vsdd.test',
    submittedAt: `2026-08-2${versionNumber}T09:00:00Z`,
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: payload(),
    ...over,
  };
}

describe('compareVersions', () => {
  it('orders previous/current by version number regardless of argument order', () => {
    const a = version(1);
    const b = version(2);
    const forward = compareVersions(a, b);
    const backward = compareVersions(b, a);
    expect(forward.previous.versionNumber).toBe(1);
    expect(forward.current.versionNumber).toBe(2);
    expect(backward.previous.versionNumber).toBe(1);
    expect(backward.current.versionNumber).toBe(2);
  });

  it('reports no changes for identical versions', () => {
    const result = compareVersions(version(1), version(2));
    expect(result.hasChanges).toBe(false);
    expect(result.changedPaths).toEqual([]);
  });

  it('preserves a numeric zero: 0 → 3 is a change, not treated as absent', () => {
    const prev = version(1, { payload: payload({ qualityEvidence: { planned: 20, executed: 15, passed: 12, openCritical: 0, blocked: 0, automationPercent: 40 } }) });
    const curr = version(2, { payload: payload({ qualityEvidence: { planned: 20, executed: 15, passed: 12, openCritical: 3, blocked: 0, automationPercent: 40 } }) });
    const result = compareVersions(prev, curr);
    const field = result.fields.find((f) => f.path === 'qualityEvidence.openCritical')!;
    expect(field.previous).toBe(0);
    expect(field.current).toBe(3);
    expect(field.changed).toBe(true);
  });

  it('preserves line breaks in free-text and detects the change', () => {
    const prev = version(1, { payload: payload({ achievements: 'Line one\nLine two' }) });
    const curr = version(2, { payload: payload({ achievements: 'Line one\nLine two\nLine three' }) });
    const result = compareVersions(prev, curr);
    const field = result.fields.find((f) => f.path === 'achievements')!;
    expect(field.previous).toBe('Line one\nLine two');
    expect(field.current).toBe('Line one\nLine two\nLine three');
    expect(field.changed).toBe(true);
  });

  it('matches exceptions by stable id: added, removed, modified and unchanged', () => {
    const keep: ExceptionItem = {
      id: 'x-keep',
      type: 'RISK',
      impact: 'Same',
      owner: 'Ana',
      dueDate: '2026-09-01',
      decisionSupport: 'Monitor',
      status: 'OPEN',
    };
    const modified: ExceptionItem = {
      id: 'x-mod',
      type: 'ISSUE',
      impact: 'Was small',
      owner: 'Ben',
      dueDate: '2026-09-02',
      decisionSupport: 'Review',
      status: 'OPEN',
    };
    const removed: ExceptionItem = {
      id: 'x-rem',
      type: 'BLOCKER',
      impact: 'Gone next version',
      owner: 'Cat',
      dueDate: '2026-09-03',
      decisionSupport: 'Escalate',
      status: 'OPEN',
    };
    const added: ExceptionItem = {
      id: 'x-add',
      type: 'RISK',
      impact: 'New risk',
      owner: 'Dan',
      dueDate: '2026-09-04',
      decisionSupport: 'Plan',
      status: 'OPEN',
    };

    const prev = version(1, { payload: payload({ exceptions: [keep, modified, removed] }) });
    const curr = version(2, {
      payload: payload({
        exceptions: [keep, { ...modified, impact: 'Now large' }, added],
      }),
    });

    const result = compareVersions(prev, curr);
    const byId = Object.fromEntries(result.exceptions.map((e) => [e.id, e.changeType]));
    expect(byId['x-keep']).toBe('UNCHANGED');
    expect(byId['x-mod']).toBe('MODIFIED');
    expect(byId['x-add']).toBe('ADDED');
    expect(byId['x-rem']).toBe('REMOVED');
    expect(result.hasChanges).toBe(true);
    expect(result.changedPaths).toContain('exceptions.x-mod');
  });
});
