/**
 * Unit tests for the field-level version comparison (task 7.8, R14.3).
 *
 * These exercise the pure `compareVersions` logic directly (no persistence):
 *  - direction is fixed by versionNumber (previous = lower, current = higher)
 *    regardless of argument order;
 *  - a scalar field change is reported with previous/current values and marked
 *    changed, while unchanged fields are reported but not flagged;
 *  - exceptions are reconciled by id: added, removed, modified and unchanged;
 *  - `changedPaths` / `hasChanges` summarise the diff;
 *  - comparing a version with itself yields no changes.
 */
import { describe, expect, it } from 'vitest';
import type {
  ExceptionItem,
  UpdatePayload,
  UpdateVersion,
} from './documents.js';
import { compareVersions } from './versionComparison.js';

function samplePayload(overrides: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: {
      business: 'Enable the September release journey.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests.',
      nextWeekCommitment: 'Confirm readiness.',
    },
    qualityEvidence: {
      planned: 120,
      executed: 84,
      passed: 79,
      openCritical: 1,
      blocked: 5,
      automationPercent: 18,
    },
    achievements: 'Execution reached 70% of plan.',
    aiValue: {
      useCase: 'AI-assisted test generation',
      measurableBenefit: '27% reduction in design effort',
      humanValidation: 'Test lead review',
      nextExperimentConstraint: 'Extend with human approval',
    },
    exceptions: [],
    leadershipAsk: 'Need a decision on extending the hardening window.',
    statusRationale: '',
    metricsNote: '',
    ...overrides,
  };
}

function sampleException(overrides: Partial<ExceptionItem> = {}): ExceptionItem {
  return {
    id: 'exc-1',
    type: 'RISK',
    impact: 'Regression coverage still incomplete.',
    owner: 'a.owner',
    dueDate: '2026-08-30',
    decisionSupport: 'Approve extra test capacity.',
    status: 'OPEN',
    ...overrides,
  };
}

function sampleVersion(
  versionNumber: number,
  payload: UpdatePayload,
  overrides: Partial<UpdateVersion> = {},
): UpdateVersion {
  return {
    id: `v-${versionNumber}`,
    programmeId: 'prog-1',
    streamId: 'stream-1',
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber,
    submittedBy: 'user-a',
    submittedAt: `2026-08-0${versionNumber}T10:00:00.000Z`,
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    hasBlocker: false,
    hasLeadershipAsk: true,
    payload,
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders the sides by versionNumber regardless of argument order', () => {
    const v1 = sampleVersion(1, samplePayload());
    const v2 = sampleVersion(2, samplePayload());

    const forward = compareVersions(v1, v2);
    const reversed = compareVersions(v2, v1);

    expect(forward.previous.versionNumber).toBe(1);
    expect(forward.current.versionNumber).toBe(2);
    // Argument order must not change the direction.
    expect(reversed.previous.versionNumber).toBe(1);
    expect(reversed.current.versionNumber).toBe(2);
  });

  it('reports no changes when both versions are identical', () => {
    const v1 = sampleVersion(1, samplePayload());
    const v2 = sampleVersion(2, samplePayload());

    const result = compareVersions(v1, v2);

    expect(result.hasChanges).toBe(false);
    expect(result.changedPaths).toEqual([]);
    expect(result.fields.every((field) => !field.changed)).toBe(true);
  });

  it('flags a changed RAG value with previous and current', () => {
    const v1 = sampleVersion(1, samplePayload());
    const v2 = sampleVersion(2, samplePayload(), {
      rag: { business: 'RED', delivery: 'AMBER', release: 'AMBER' },
    });

    const result = compareVersions(v1, v2);

    const business = result.fields.find((field) => field.path === 'rag.business');
    expect(business).toMatchObject({ previous: 'GREEN', current: 'RED', changed: true });
    // The other RAG dimensions are unchanged.
    expect(result.fields.find((f) => f.path === 'rag.delivery')?.changed).toBe(false);
    expect(result.changedPaths).toContain('rag.business');
    expect(result.hasChanges).toBe(true);
  });

  it('flags changed scalar payload fields (goal text and a numeric metric)', () => {
    const v1 = sampleVersion(1, samplePayload());
    const v2 = sampleVersion(
      2,
      samplePayload({
        goals: {
          business: 'Pivot to hardening the release candidate.',
          technicalTesting: 'Close critical regression gaps.',
          sprintCommitment: 'Execute committed tests.',
          nextWeekCommitment: 'Confirm readiness.',
        },
        qualityEvidence: {
          planned: 120,
          executed: 100,
          passed: 79,
          openCritical: 1,
          blocked: 5,
          automationPercent: 18,
        },
      }),
    );

    const result = compareVersions(v1, v2);

    expect(result.fields.find((f) => f.path === 'goals.business')).toMatchObject({
      previous: 'Enable the September release journey.',
      current: 'Pivot to hardening the release candidate.',
      changed: true,
    });
    expect(result.fields.find((f) => f.path === 'qualityEvidence.executed')).toMatchObject({
      previous: 84,
      current: 100,
      changed: true,
    });
    expect(result.changedPaths).toEqual(
      expect.arrayContaining(['goals.business', 'qualityEvidence.executed']),
    );
  });

  it('treats an absent optional field as unchanged null across versions', () => {
    const v1 = sampleVersion(1, samplePayload({ statusRationale: undefined }));
    const v2 = sampleVersion(2, samplePayload({ statusRationale: '' }));

    const result = compareVersions(v1, v2);

    // undefined and '' both normalise to null, so no spurious change.
    const rationale = result.fields.find((f) => f.path === 'statusRationale');
    expect(rationale).toMatchObject({ previous: null, current: null, changed: false });
  });

  it('detects an added exception', () => {
    const v1 = sampleVersion(1, samplePayload({ exceptions: [] }));
    const v2 = sampleVersion(2, samplePayload({ exceptions: [sampleException()] }));

    const result = compareVersions(v1, v2);

    const added = result.exceptions.find((e) => e.id === 'exc-1');
    expect(added?.changeType).toBe('ADDED');
    expect(result.changedPaths).toContain('exceptions.exc-1');
    expect(result.hasChanges).toBe(true);
  });

  it('detects a removed exception', () => {
    const v1 = sampleVersion(1, samplePayload({ exceptions: [sampleException()] }));
    const v2 = sampleVersion(2, samplePayload({ exceptions: [] }));

    const result = compareVersions(v1, v2);

    const removed = result.exceptions.find((e) => e.id === 'exc-1');
    expect(removed?.changeType).toBe('REMOVED');
    expect(result.changedPaths).toContain('exceptions.exc-1');
  });

  it('detects a modified exception and reports the changed inner field', () => {
    const v1 = sampleVersion(1, samplePayload({ exceptions: [sampleException()] }));
    const v2 = sampleVersion(
      2,
      samplePayload({
        exceptions: [
          sampleException({ status: 'RESOLVED', resolvedAt: '2026-09-01', resolutionNote: 'Closed.' }),
        ],
      }),
    );

    const result = compareVersions(v1, v2);

    const modified = result.exceptions.find((e) => e.id === 'exc-1');
    expect(modified?.changeType).toBe('MODIFIED');
    const statusField = modified?.fields.find((f) => f.path === 'status');
    expect(statusField).toMatchObject({ previous: 'OPEN', current: 'RESOLVED', changed: true });
    const resolvedField = modified?.fields.find((f) => f.path === 'resolvedAt');
    expect(resolvedField).toMatchObject({ previous: null, current: '2026-09-01', changed: true });
  });

  it('marks an unchanged exception as UNCHANGED', () => {
    const v1 = sampleVersion(1, samplePayload({ exceptions: [sampleException()] }));
    const v2 = sampleVersion(2, samplePayload({ exceptions: [sampleException()] }));

    const result = compareVersions(v1, v2);

    const unchanged = result.exceptions.find((e) => e.id === 'exc-1');
    expect(unchanged?.changeType).toBe('UNCHANGED');
    expect(result.changedPaths).not.toContain('exceptions.exc-1');
    expect(result.hasChanges).toBe(false);
  });
});
