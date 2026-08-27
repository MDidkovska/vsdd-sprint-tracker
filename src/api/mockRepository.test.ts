import { beforeEach, describe, expect, it } from 'vitest';
import { MockRepository } from './mockRepository';
import { PermissionDeniedError, RepositoryError, RevisionConflictError, type CurrentUser } from './repository';
import type { UpdatePayload } from '../domain/update';
import { PROGRAMME_ID } from '../config';

function makeUser(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    subject: 'u',
    displayName: 'U',
    initials: 'U',
    roleLabel: 'role',
    roles: [],
    assignedTeamIds: [],
    canViewAll: false,
    ...overrides,
  };
}

function samplePayload(overrides: Partial<UpdatePayload> = {}): UpdatePayload {
  return {
    goals: {
      business: 'Business goal',
      technicalTesting: 'Technical goal',
      sprintCommitment: 'Sprint commitment',
      nextWeekCommitment: 'Next week commitment',
    },
    qualityEvidence: { planned: 100, executed: 80, passed: 75, openCritical: 0, blocked: 2, automationPercent: 20 },
    achievements: 'Progress made.',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: 'None',
    statusRationale: '',
    metricsNote: '',
    ...overrides,
  };
}

let repo: MockRepository;
beforeEach(() => {
  repo = new MockRepository({ latencyMs: 0 });
});

describe('seeded hierarchy and teams', () => {
  it('exposes all eight teams grouped into five streams', async () => {
    const tree = await repo.getHierarchy(PROGRAMME_ID);
    const teamCount = tree.streams.reduce((n, s) => n + s.teams.length, 0);
    expect(teamCount).toBe(8);
    expect(tree.streams.map((s) => s.stream.id)).toEqual(['MMM', 'OAH', 'GRMB', 'O24', 'Visa']);
  });

  it('uses "Visa" as the stream and VIS-PMNT as the team', async () => {
    const tree = await repo.getHierarchy(PROGRAMME_ID);
    const visa = tree.streams.find((s) => s.stream.id === 'Visa');
    expect(visa?.stream.name).toBe('Visa');
    expect(visa?.teams[0]?.name).toBe('VIS-PMNT');
  });
});

describe('update states across Week 1 and Week 2', () => {
  it('returns a Submitted Week 1 update for mmm-a', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' });
    expect(doc.state).toBe('SUBMITTED');
  });

  it('returns a Missing document when nothing exists for the checkpoint', async () => {
    const doc = await repo.getUpdate({ teamId: 'oah-sales', sprintId: 'S14', checkpointId: 'C14-2' });
    expect(doc.state).toBe('MISSING');
    expect(doc.revision).toBe(0);
  });

  it('returns a Reopened Week 2 update for oah-ils', async () => {
    const doc = await repo.getUpdate({ teamId: 'oah-ils', sprintId: 'S14', checkpointId: 'C14-2' });
    expect(doc.state).toBe('REOPENED');
  });
});

describe('leadership snapshot state derivation', () => {
  it('derives Stale when the current checkpoint has no submission but an earlier one exists', async () => {
    const snapshot = await repo.getLeadershipSnapshot(PROGRAMME_ID, 'S14', 'C14-2');
    const visa = snapshot.streams
      .flatMap((s) => s.teams)
      .find((t) => t.team.id === 'visa');
    expect(visa?.resolved.cellState).toBe('STALE');
    expect(visa?.resolved.isStale).toBe(true);
    expect(visa?.resolved.isSubmittedEvidence).toBe(false);
    expect(visa?.resolved.sourceWeekNumber).toBe(1);
  });

  it('derives Missing when no submission exists anywhere earlier', async () => {
    const snapshot = await repo.getLeadershipSnapshot(PROGRAMME_ID, 'S14', 'C14-2');
    const oahSales = snapshot.streams
      .flatMap((s) => s.teams)
      .find((t) => t.team.id === 'oah-sales');
    expect(oahSales?.resolved.cellState).toBe('MISSING');
    expect(oahSales?.resolved.payload).toBeNull();
  });

  it('marks a Submitted Week 1 cell as leadership evidence', async () => {
    const snapshot = await repo.getLeadershipSnapshot(PROGRAMME_ID, 'S14', 'C14-1');
    const grmb = snapshot.streams.flatMap((s) => s.teams).find((t) => t.team.id === 'grmb');
    expect(grmb?.resolved.cellState).toBe('SUBMITTED');
    expect(grmb?.resolved.isSubmittedEvidence).toBe(true);
  });
});

describe('draft save and optimistic concurrency', () => {
  it('increments the revision on a successful save', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' });
    const saved = await repo.saveDraft({
      teamId: 'mmm-a',
      sprintId: 'S14',
      checkpointId: 'C14-2',
      revision: doc.revision,
      rag: doc.rag,
      payload: samplePayload(),
    });
    expect(saved.revision).toBe(doc.revision + 1);
  });

  it('rejects a save with a stale revision without overwriting (409)', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' });
    await expect(
      repo.saveDraft({
        teamId: 'mmm-a',
        sprintId: 'S14',
        checkpointId: 'C14-2',
        revision: doc.revision - 1,
        rag: doc.rag,
        payload: samplePayload(),
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('simulates a concurrent edit on an armed draft (mmm-b Week 1)', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-b', sprintId: 'S14', checkpointId: 'C14-1' });
    await expect(
      repo.saveDraft({
        teamId: 'mmm-b',
        sprintId: 'S14',
        checkpointId: 'C14-1',
        revision: doc.revision,
        rag: doc.rag,
        payload: samplePayload(),
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('simulates a transient failure via the #failsave trigger', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' });
    await expect(
      repo.saveDraft({
        teamId: 'mmm-a',
        sprintId: 'S14',
        checkpointId: 'C14-2',
        revision: doc.revision,
        rag: doc.rag,
        payload: samplePayload({ leadershipAsk: 'Please #failsave this one' }),
      }),
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' });
  });
});

describe('permissions', () => {
  it('denies editing a team the user is not assigned to (o24-desktop)', async () => {
    const doc = await repo.getUpdate({ teamId: 'o24-desktop', sprintId: 'S14', checkpointId: 'C14-1' });
    await expect(
      repo.saveDraft({
        teamId: 'o24-desktop',
        sprintId: 'S14',
        checkpointId: 'C14-1',
        revision: doc.revision,
        rag: doc.rag,
        payload: samplePayload(),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('blocks edits to a closed reporting window', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-a', sprintId: 'S13', checkpointId: 'C13-2' });
    await expect(
      repo.saveDraft({
        teamId: 'mmm-a',
        sprintId: 'S13',
        checkpointId: 'C13-2',
        revision: doc.revision,
        rag: doc.rag,
        payload: samplePayload(),
      }),
    ).rejects.toMatchObject({ code: 'WINDOW_CLOSED' });
  });
});

describe('immutable submission and audit', () => {
  it('creates an immutable version and an audit event atomically', async () => {
    const doc = await repo.getUpdate({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' });
    const { document, version } = await repo.submit({
      teamId: 'mmm-a',
      sprintId: 'S14',
      checkpointId: 'C14-2',
      revision: doc.revision,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      payload: samplePayload(),
    });
    expect(document.state).toBe('SUBMITTED');

    const versions = await repo.getVersions({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' });
    expect(versions.some((v) => v.id === version.id)).toBe(true);

    const audit = await repo.getAudit(version.id);
    expect(audit.some((e) => e.action === 'SUBMITTED')).toBe(true);
  });

  it('preserves the prior immutable version through a reopen + resubmit cycle', async () => {
    const loc = { teamId: 'grmb', sprintId: 'S14', checkpointId: 'C14-1' };
    const before = await repo.getVersions(loc);
    const firstVersion = before[0]!;
    const originalBusiness = firstVersion.payload.goals.business;

    // Valid sequence: SUBMITTED -> REOPENED -> DRAFT -> SUBMITTED.
    const reopened = await repo.reopen({ versionId: firstVersion.id, reason: 'Fixing the executed count.' });
    expect(reopened.state).toBe('REOPENED');

    const draft = await repo.saveDraft({
      ...loc,
      revision: reopened.revision,
      rag: reopened.rag,
      payload: samplePayload({
        goals: {
          business: 'COMPLETELY DIFFERENT',
          technicalTesting: 'x',
          sprintCommitment: 'x',
          nextWeekCommitment: 'x',
        },
      }),
    });
    expect(draft.state).toBe('REOPENED');

    const { document } = await repo.submit({
      ...loc,
      revision: draft.revision,
      rag: draft.rag,
      payload: draft.payload,
    });
    expect(document.state).toBe('SUBMITTED');

    const after = await repo.getVersions(loc);
    const preserved = after.find((v) => v.id === firstVersion.id);
    expect(preserved?.payload.goals.business).toBe(originalBusiness);
    expect(after.length).toBe(before.length + 1);
  });
});

describe('state-machine enforcement in the repository', () => {
  it('rejects saveDraft on a submitted update (must reopen first)', async () => {
    const loc = { teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' };
    const doc = await repo.getUpdate(loc);
    expect(doc.state).toBe('SUBMITTED');
    await expect(
      repo.saveDraft({ ...loc, revision: doc.revision, rag: doc.rag, payload: samplePayload() }),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
  });

  it('rejects submit on a submitted update (must reopen first)', async () => {
    const loc = { teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' };
    const doc = await repo.getUpdate(loc);
    await expect(
      repo.submit({ ...loc, revision: doc.revision, rag: doc.rag, payload: samplePayload() }),
    ).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
  });
});

describe('reopen workflow', () => {
  it('reopens a submitted version into a Reopened draft and records the reason', async () => {
    const versions = await repo.getVersions({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' });
    const version = versions[0]!;
    const reopened = await repo.reopen({ versionId: version.id, reason: 'Correcting the executed count.' });
    expect(reopened.state).toBe('REOPENED');

    const audit = await repo.getAudit(reopened.id);
    const reopenEvent = audit.find((e) => e.action === 'REOPENED');
    expect(reopenEvent?.reason).toBe('Correcting the executed count.');
  });

  it('requires a reason to reopen', async () => {
    const versions = await repo.getVersions({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' });
    await expect(repo.reopen({ versionId: versions[0]!.id, reason: '   ' })).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });
});

describe('role boundaries', () => {
  const draftLoc = { teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' }; // editable draft

  it('Contributor can save a draft but cannot submit or reopen', async () => {
    const contributor = new MockRepository({
      latencyMs: 0,
      user: makeUser({ roles: ['CONTRIBUTOR'], assignedTeamIds: ['mmm-a'] }),
    });
    const doc = await contributor.getUpdate(draftLoc);
    const saved = await contributor.saveDraft({
      ...draftLoc,
      revision: doc.revision,
      rag: doc.rag,
      payload: samplePayload(),
    });
    expect(saved.revision).toBe(doc.revision + 1);

    await expect(
      contributor.submit({ ...draftLoc, revision: saved.revision, rag: saved.rag, payload: samplePayload() }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const versions = await contributor.getVersions({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' });
    await expect(contributor.reopen({ versionId: versions[0]!.id, reason: 'x' })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('Auditor cannot edit any draft', async () => {
    const auditor = new MockRepository({
      latencyMs: 0,
      user: makeUser({ roles: ['AUDITOR'], assignedTeamIds: [] }),
    });
    const doc = await auditor.getUpdate(draftLoc);
    await expect(
      auditor.saveDraft({ ...draftLoc, revision: doc.revision, rag: doc.rag, payload: samplePayload() }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('only Leadership can record a decision', async () => {
    const teamLead = new MockRepository({
      latencyMs: 0,
      user: makeUser({ roles: ['TEAM_LEAD'], assignedTeamIds: ['mmm-a'] }),
    });
    const versions = await teamLead.getVersions({ teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-1' });
    await expect(
      teamLead.recordDecision({ versionId: versions[0]!.id, decision: 'Approve' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('leadership evidence integrity', () => {
  it('never presents a Missing cell as Green (rag is null)', async () => {
    const snapshot = await repo.getLeadershipSnapshot(PROGRAMME_ID, 'S14', 'C14-2');
    const oahSales = snapshot.streams.flatMap((s) => s.teams).find((t) => t.team.id === 'oah-sales');
    expect(oahSales?.resolved.cellState).toBe('MISSING');
    expect(oahSales?.resolved.rag).toBeNull();
  });

  it('hasBlocker is false once the only blocker is resolved', async () => {
    const loc = { teamId: 'mmm-a', sprintId: 'S14', checkpointId: 'C14-2' };
    const doc = await repo.getUpdate(loc);
    const withResolvedBlocker = samplePayload({
      exceptions: [
        {
          id: 'b1',
          type: 'BLOCKER',
          impact: 'Pipeline was stopped.',
          owner: 'DevOps',
          dueDate: '2026-08-27',
          decisionSupport: 'Approve rule.',
          status: 'RESOLVED',
          resolvedAt: '2026-08-27',
          resolutionNote: 'Firewall rule approved.',
        },
      ],
    });
    const saved = await repo.saveDraft({ ...loc, revision: doc.revision, rag: doc.rag, payload: withResolvedBlocker });
    expect(saved.hasBlocker).toBe(false);
  });
});

describe('filtered export', () => {
  it('exports only Visa + Missing records', async () => {
    const snapshot = await repo.export({
      programmeId: PROGRAMME_ID,
      sprintId: 'S14',
      checkpointId: 'C14-2',
      filters: { streamId: 'Visa', rag: 'ALL', state: 'MISSING' },
    });
    // Visa is Stale at W2 (not Missing), so this filter yields zero records.
    expect(snapshot.recordCount).toBe(0);
    expect(snapshot.filters.streamId).toBe('Visa');
  });

  it('a zero-result filter yields an empty export', async () => {
    const snapshot = await repo.export({
      programmeId: PROGRAMME_ID,
      sprintId: 'S14',
      checkpointId: 'C14-1',
      filters: { streamId: 'Visa', rag: 'RED', state: 'ALL' },
    });
    expect(snapshot.recordCount).toBe(0);
    expect(snapshot.records).toHaveLength(0);
  });

  it('an Amber export contains only teams with an Amber dimension', async () => {
    const snapshot = await repo.export({
      programmeId: PROGRAMME_ID,
      sprintId: 'S14',
      checkpointId: 'C14-1',
      filters: { streamId: 'ALL', rag: 'AMBER', state: 'ALL' },
    });
    expect(snapshot.recordCount).toBeGreaterThan(0);
    expect(
      snapshot.records.every((r) => r.rag && Object.values(r.rag).includes('AMBER')),
    ).toBe(true);
  });
});

describe('export', () => {
  it('marks stale/missing records and includes reporting period', async () => {
    const snapshot = await repo.export({
      programmeId: PROGRAMME_ID,
      sprintId: 'S14',
      checkpointId: 'C14-2',
      filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
    });
    expect(snapshot.reportingPeriodLabel).toContain('Week 2');
    expect(snapshot.recordCount).toBe(8);
    const visa = snapshot.records.find((r) => r.teamId === 'visa');
    expect(visa?.state).toBe('STALE');
    expect(visa?.isSubmittedEvidence).toBe(false);
  });
});
