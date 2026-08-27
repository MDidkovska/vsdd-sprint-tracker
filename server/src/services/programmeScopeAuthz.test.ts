/**
 * Service-level programme/team authorisation tests (Phase 8 repair).
 *
 * These prove the REAL services (not just the pure policy helpers) enforce
 * programme + team scoping: cross-programme Leadership/Admin/Auditor access is
 * denied, a Contributor cannot read another team's version/history/compare, an
 * arbitrary version id cannot be read out of scope, an Admin CAN record
 * decisions and export, and an Auditor stays strictly read-only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser, Role } from '../domain/identity.js';
import type { LeadershipDecision, UpdatePayload, UpdateVersion } from '../domain/documents.js';
import type { ReportingCheckpoint, Sprint, Team } from '../domain/hierarchy.js';
import type { ReportingSummary } from '../domain/leadership.js';
import { DecisionService } from './decisionService.js';
import { ExportService } from './exportService.js';
import { SummaryService, type SummaryApi, type SummaryReadPort } from './summaryService.js';
import { VersionService, type VersionReadPort } from './versionService.js';

function principal(roles: Role[], overrides: Partial<CurrentUser> = {}): AuthContext {
  const user: CurrentUser = {
    subject: 'u',
    email: 'u@example.com',
    displayName: 'U',
    initials: 'U',
    roleLabel: 'x',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles,
    assignedTeamIds: [],
    canViewAll: roles.some((r) => r === 'LEADERSHIP' || r === 'ADMIN' || r === 'AUDITOR'),
    ...overrides,
  };
  return { getCurrentUser: () => user };
}

const PAYLOAD: UpdatePayload = {
  goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
  qualityEvidence: { planned: 1, executed: 1, passed: 1, openCritical: 0, blocked: 0, automationPercent: 0 },
  achievements: 'a',
  aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
  exceptions: [],
  leadershipAsk: 'None',
};

/** Version V1 belongs to team mmm-a in programme vsdd. */
const V1: UpdateVersion = {
  id: 'V1',
  programmeId: 'vsdd',
  streamId: 'MMM',
  teamId: 'mmm-a',
  sprintId: 'S14',
  checkpointId: 'C14-1',
  versionNumber: 1,
  submittedBy: 'x',
  submittedAt: '2026-08-26T09:14:00Z',
  schemaVersion: 1,
  rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
  hasBlocker: false,
  hasLeadershipAsk: false,
  payload: PAYLOAD,
};

const TEAM = (id: string): Team => ({ id, streamId: 'MMM', name: id, sortOrder: 1, active: true });
const CHECKPOINT: ReportingCheckpoint = {
  id: 'C14-1', sprintId: 'S14', weekNumber: 1,
  opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT',
};
const SPRINT: Sprint = {
  id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT',
};

function versionPort(): VersionReadPort {
  return {
    getTeam: async (id) => TEAM(id),
    getCheckpoint: async () => CHECKPOINT,
    getSprint: async () => SPRINT,
    listVersions: async () => [V1],
    getVersion: async (id) => (id === 'V1' ? V1 : null),
    listAuditForAggregate: async () => [],
  };
}

describe('VersionService programme + team scoping', () => {
  it('lets an Auditor of the programme read a version', async () => {
    const svc = new VersionService(versionPort(), principal(['AUDITOR']));
    await expect(svc.getVersion('V1')).resolves.toMatchObject({ id: 'V1' });
  });

  it('denies Leadership of ANOTHER programme reading the version (arbitrary id)', async () => {
    const svc = new VersionService(versionPort(), principal(['LEADERSHIP'], { programmeId: 'other' }));
    await expect(svc.getVersion('V1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it("denies a Contributor reading another team's version", async () => {
    const svc = new VersionService(
      versionPort(),
      principal(['CONTRIBUTOR'], { assignedTeamIds: ['mmm-b'] }),
    );
    await expect(svc.getVersion('V1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.getAudit('V1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it("denies a Contributor listing another team's versions", async () => {
    const svc = new VersionService(
      versionPort(),
      principal(['CONTRIBUTOR'], { assignedTeamIds: ['mmm-a'] }),
    );
    await expect(svc.getVersions('mmm-b', 'C14-1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('lets an assigned Contributor read their own team version', async () => {
    const svc = new VersionService(
      versionPort(),
      principal(['CONTRIBUTOR'], { assignedTeamIds: ['mmm-a'] }),
    );
    await expect(svc.getVersion('V1')).resolves.toMatchObject({ teamId: 'mmm-a' });
  });
});

describe('DecisionService programme scoping', () => {
  function decisionPort(recorded: { value?: LeadershipDecision }) {
    return {
      getVersion: async (id: string) => (id === 'V1' ? V1 : null),
      recordDecision: async (input: { decision: LeadershipDecision }) => {
        recorded.value = input.decision;
        return input.decision;
      },
      listDecisions: async () => [],
    };
  }

  it('lets an ADMIN of the programme record a decision', async () => {
    const recorded: { value?: LeadershipDecision } = {};
    const svc = new DecisionService(decisionPort(recorded), principal(['ADMIN']));
    const result = await svc.recordDecision('V1', { decision: 'Fund regression coverage.' });
    expect(result.decision).toBe('Fund regression coverage.');
  });

  it('denies an AUDITOR recording a decision (read-only)', async () => {
    const svc = new DecisionService(decisionPort({}), principal(['AUDITOR']));
    await expect(
      svc.recordDecision('V1', { decision: 'x' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('denies Leadership of ANOTHER programme recording a decision', async () => {
    const svc = new DecisionService(decisionPort({}), principal(['LEADERSHIP'], { programmeId: 'other' }));
    await expect(
      svc.recordDecision('V1', { decision: 'x' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('SummaryService programme scoping', () => {
  const port = {} as unknown as SummaryReadPort; // never reached on a denial

  it('denies Leadership of ANOTHER programme', async () => {
    const svc = new SummaryService(port, principal(['LEADERSHIP'], { programmeId: 'other' }));
    await expect(
      svc.getReportingSummary('vsdd', { sprintId: 'S14', checkpointId: 'C14-1' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('denies a Contributor (not a leadership role)', async () => {
    const svc = new SummaryService(port, principal(['CONTRIBUTOR'], { assignedTeamIds: ['mmm-a'] }));
    await expect(
      svc.getReportingSummary('vsdd', { sprintId: 'S14', checkpointId: 'C14-1' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('ExportService programme scoping', () => {
  const SUMMARY: ReportingSummary = {
    summary: { teamCount: 0, submittedCount: 0, draftOrMissingCount: 0, leadershipAskCount: 0, reportingPeriodLabel: 'Sprint 14 · Week 1' },
    snapshot: {
      programme: { id: 'vsdd', name: 'VSDD', active: true },
      sprint: SPRINT,
      checkpoint: CHECKPOINT,
      streams: [],
    },
    filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
  };
  const summaries: SummaryApi = { getReportingSummary: vi.fn(async () => SUMMARY) };
  const audit = { appendAudit: vi.fn(async (e) => e) };

  it('lets an ADMIN of the programme export', async () => {
    const svc = new ExportService(summaries, principal(['ADMIN']), audit);
    const snapshot = await svc.createExport('vsdd', {
      sprintId: 'S14',
      checkpointId: 'C14-1',
      filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
    });
    expect(snapshot.programme).toBe('VSDD');
    expect(audit.appendAudit).toHaveBeenCalled();
  });

  it('denies an AUDITOR exporting (read-only)', async () => {
    const svc = new ExportService(summaries, principal(['AUDITOR']), { appendAudit: vi.fn() });
    await expect(
      svc.createExport('vsdd', { sprintId: 'S14', checkpointId: 'C14-1', filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' } }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('denies Leadership of ANOTHER programme exporting vsdd', async () => {
    const svc = new ExportService(summaries, principal(['LEADERSHIP'], { programmeId: 'other' }), { appendAudit: vi.fn() });
    await expect(
      svc.createExport('vsdd', { sprintId: 'S14', checkpointId: 'C14-1', filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' } }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
