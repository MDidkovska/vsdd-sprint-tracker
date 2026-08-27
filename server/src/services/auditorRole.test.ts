/**
 * Auditor read-only role — service-level completeness (Phase 9, task 9.7).
 *
 * Consolidates and COMPLETES the read-only Auditor policy across the REAL
 * business services, closing the gaps left by the earlier phases:
 *  - authorization.test.ts (8.10) proves the pure policy helpers throw for an
 *    Auditor, and programmeScopeAuthz.test.ts (8.13) proves the Decision and
 *    Export services refuse an Auditor and the Version service lets one read a
 *    single version.
 *  - This file proves the SERVICES that were only ever exercised with a
 *    Contributor/Leadership principal also refuse an Auditor: Draft (save),
 *    Submit, Reopen, the account AdminService (approve/reject/assign/suspend)
 *    and the HierarchyAdminService (streams/teams/sprints/checkpoints/archive).
 *  - It also proves the Auditor's positive read surface that was not yet
 *    covered: listing a team's submitted versions AND comparing two versions
 *    (design §5a: an Auditor may read "submitted versions/comparisons").
 *
 * The Auditor must never mutate any resource — draft, submit, reopen, decision,
 * export or any admin/assignment action — and each denial is a PERMISSION_DENIED
 * (surfaced as HTTP 403). Decision/export denials live in programmeScopeAuthz to
 * avoid duplication.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import type { UserAccount } from '../domain/accounts.js';
import type { AuditEvent, UpdateDocument, UpdatePayload, UpdateVersion } from '../domain/documents.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import type {
  SaveDraftInput,
  SubmitDraftInput,
  SubmitOutcome,
  ReopenUpdateInput,
  ReopenOutcome,
  WriteOutcome,
} from '../repository/documentRepository.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { SubmitService } from './submitService.js';
import { ReopenService, type ReopenRepositoryPort } from './reopenService.js';
import { VersionService, type VersionReadPort } from './versionService.js';
import { AdminService } from './adminService.js';
import { HierarchyAdminService, type HierarchyAdminRepository } from './hierarchyAdminService.js';

/** A programme-scoped, ACTIVE Auditor principal. */
function auditor(): CurrentUser {
  return {
    subject: 'aud-1',
    email: 'auditor@example.com',
    displayName: 'Avery Auditor',
    initials: 'AA',
    roleLabel: 'Auditor',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles: ['AUDITOR'],
    assignedTeamIds: [],
    canViewAll: true,
  };
}

function auditorAuth(): AuthContext {
  return { getCurrentUser: () => auditor() };
}

// ---- shared fixtures ------------------------------------------------------

const TEAM: Team = { id: 'mmm-a', streamId: 'MMM', name: 'PTSB-VSDD MMM A', sortOrder: 1, active: true };
const CHECKPOINT: ReportingCheckpoint = {
  id: 'C14-1', sprintId: 'S14', weekNumber: 1,
  opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT',
};
const SPRINT: Sprint = {
  id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT',
};

const PAYLOAD: UpdatePayload = {
  goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
  qualityEvidence: { planned: 1, executed: 1, passed: 1, openCritical: 0, blocked: 0, automationPercent: 0 },
  achievements: 'a',
  aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
  exceptions: [],
  leadershipAsk: 'None',
};

function version(id: string, versionNumber: number, achievements: string): UpdateVersion {
  return {
    id,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber,
    submittedBy: 'lead-1',
    submittedAt: `2026-08-2${versionNumber}T09:14:00Z`,
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: { ...PAYLOAD, achievements },
  };
}

const REQUEST: DraftUpdateRequest = {
  revision: 0,
  rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
  goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
  qualityEvidence: { planned: 1, executed: 1, passed: 1, openCritical: 0, blocked: 0, automationPercent: 0 },
  achievements: 'a',
  aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
  exceptions: [],
  leadershipAsk: 'None',
};

/** A write repo whose write paths blow up if ever reached (proves early denial). */
function writeRepo() {
  return {
    getTeam: async (id: string) => (id === TEAM.id ? TEAM : null),
    getCheckpoint: async (id: string) => (id === CHECKPOINT.id ? CHECKPOINT : null),
    getSprint: async (id: string) => (id === SPRINT.id ? SPRINT : null),
    getDraft: async () => null,
    saveDraft: async (_input: SaveDraftInput): Promise<WriteOutcome<UpdateDocument>> => {
      throw new Error('saveDraft must not be reached for an Auditor');
    },
    listVersions: async () => [version('mmm-a-S14-C14-1-v1', 1, 'a')],
    submitUpdate: async (_input: SubmitDraftInput): Promise<SubmitOutcome> => {
      throw new Error('submitUpdate must not be reached for an Auditor');
    },
  };
}

// ---- draft / submit / reopen (mutations) ----------------------------------

describe('Auditor cannot save a draft, submit or reopen', () => {
  it('denies DraftService.saveDraft (403)', async () => {
    const svc = new DraftService(writeRepo(), auditorAuth());
    await expect(svc.saveDraft('mmm-a', 'C14-1', REQUEST)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('still lets an Auditor READ a team update (read-only allowed)', async () => {
    const svc = new DraftService(writeRepo(), auditorAuth());
    const doc = await svc.getUpdate('mmm-a', 'C14-1');
    expect(doc.state).toBe('MISSING');
  });

  it('denies SubmitService.submit (403)', async () => {
    const svc = new SubmitService(writeRepo(), auditorAuth());
    await expect(svc.submit('mmm-a', 'C14-1', REQUEST)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('denies ReopenService.reopen (403) before any write', async () => {
    const port: ReopenRepositoryPort = {
      getVersion: async (id) => (id === 'V1' ? version('V1', 1, 'a') : null),
      getDraft: async () => {
        throw new Error('getDraft must not be reached for an Auditor');
      },
      listVersions: async () => {
        throw new Error('listVersions must not be reached for an Auditor');
      },
      reopenUpdate: async (_input: ReopenUpdateInput): Promise<ReopenOutcome> => {
        throw new Error('reopenUpdate must not be reached for an Auditor');
      },
    };
    const svc = new ReopenService(port, auditorAuth());
    await expect(svc.reopen('V1', { reason: 'late submission agreed' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});

// ---- version list + compare (reads the Auditor MAY perform) ----------------

describe('Auditor may read submitted versions and comparisons', () => {
  function versionPort(): VersionReadPort {
    const v1 = version('V1', 1, 'first draft achievements');
    const v2 = version('V2', 2, 'second draft achievements');
    return {
      getTeam: async (id) => (id === 'mmm-a' ? TEAM : null),
      getCheckpoint: async () => CHECKPOINT,
      getSprint: async () => SPRINT,
      listVersions: async () => [v2, v1],
      getVersion: async (id) => (id === 'V1' ? v1 : id === 'V2' ? v2 : null),
      listAuditForAggregate: async () => [],
    };
  }

  it('lists a team + checkpoint\u2019s submitted versions', async () => {
    const svc = new VersionService(versionPort(), auditorAuth());
    const versions = await svc.getVersions('mmm-a', 'C14-1');
    expect(versions.map((v) => v.id)).toEqual(['V2', 'V1']);
  });

  it('compares two versions field by field', async () => {
    const svc = new VersionService(versionPort(), auditorAuth());
    const diff = await svc.compareVersions('V1', 'V2');
    // The two versions differ only in the achievements free-text.
    const json = JSON.stringify(diff);
    expect(json).toContain('first draft achievements');
    expect(json).toContain('second draft achievements');
  });
});

// ---- account administration (mutations) ------------------------------------

describe('Auditor cannot perform account administration', () => {
  const reference = {
    getProgramme: async (id: string) =>
      id === 'vsdd' ? { id: 'vsdd', name: 'VSDD', active: true } : null,
    listTeams: async () => [TEAM],
  };

  function pendingUser(id: string): UserAccount {
    const now = new Date().toISOString();
    return {
      id,
      email: `${id}@example.com`,
      displayName: `User ${id}`,
      passwordHash: '$argon2id$fake',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
  }

  let repo: InMemoryIdentityRepository;
  let service: AdminService;

  beforeEach(async () => {
    repo = new InMemoryIdentityRepository();
    service = new AdminService({ identity: repo, reference, auth: auditorAuth() });
    await repo.insertUser(pendingUser('u1'));
  });

  it('denies listUsers, approve, reject, updateAssignments and suspend (403)', async () => {
    await expect(service.listUsers('PENDING')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.approve('u1', { programmeId: 'vsdd', teamIds: ['mmm-a'], roles: ['TEAM_LEAD'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.reject('u1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.updateAssignments('u1', { programmeId: 'vsdd', teamIds: ['mmm-a'], roles: ['CONTRIBUTOR'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.suspend('u1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // Nothing changed: the user is still PENDING and no audit was appended.
    expect((await repo.getUserById('u1'))?.status).toBe('PENDING');
    expect(repo.auditEvents).toHaveLength(0);
  });
});

// ---- hierarchy / sprint / checkpoint administration (mutations) ------------

describe('Auditor cannot perform hierarchy / sprint / checkpoint administration', () => {
  class FakeRepo implements HierarchyAdminRepository {
    programmes = new Map<string, Programme>([['vsdd', { id: 'vsdd', name: 'VSDD', active: true }]]);
    streams = new Map<string, Stream>([
      ['MMM', { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true }],
    ]);
    teams = new Map<string, Team>([['mmm-a', { ...TEAM }]]);
    sprints = new Map<string, Sprint>();
    checkpoints = new Map<string, ReportingCheckpoint>();
    audits: AuditEvent[] = [];

    async getProgramme(id: string) {
      return this.programmes.get(id) ?? null;
    }
    async getStream(id: string) {
      return this.streams.get(id) ?? null;
    }
    async saveStreamWithAudit(stream: Stream, audit: AuditEvent) {
      this.streams.set(stream.id, stream);
      this.audits.push(audit);
      return stream;
    }
    async getTeam(id: string) {
      return this.teams.get(id) ?? null;
    }
    async listTeams(programmeId: string) {
      const ids = new Set(
        [...this.streams.values()].filter((s) => s.programmeId === programmeId).map((s) => s.id),
      );
      return [...this.teams.values()].filter((t) => ids.has(t.streamId));
    }
    async saveTeamWithAudit(team: Team, audit: AuditEvent) {
      this.teams.set(team.id, team);
      this.audits.push(audit);
      return team;
    }
    async getSprint(id: string) {
      return this.sprints.get(id) ?? null;
    }
    async createSprint(sprint: Sprint, checkpoints: ReportingCheckpoint[], audit: AuditEvent) {
      this.sprints.set(sprint.id, sprint);
      for (const cp of checkpoints) this.checkpoints.set(cp.id, cp);
      this.audits.push(audit);
      return { sprint, checkpoints };
    }
    async getCheckpoint(id: string) {
      return this.checkpoints.get(id) ?? null;
    }
    async listCheckpoints(sprintId: string) {
      return [...this.checkpoints.values()].filter((c) => c.sprintId === sprintId);
    }
    async saveCheckpointsWithAudit(checkpoints: ReportingCheckpoint[], audit: AuditEvent) {
      for (const cp of checkpoints) this.checkpoints.set(cp.id, cp);
      this.audits.push(audit);
      return checkpoints;
    }
  }

  let repo: FakeRepo;
  let service: HierarchyAdminService;

  beforeEach(() => {
    repo = new FakeRepo();
    service = new HierarchyAdminService({ repository: repo, auth: auditorAuth() });
  });

  it('denies stream/team/sprint/checkpoint config and team archival (403)', async () => {
    await expect(
      service.createStream({ id: 'GRMB', programmeId: 'vsdd', name: 'GRMB' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.createTeam({ id: 't', programmeId: 'vsdd', streamId: 'MMM', name: 'T' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.createSprint({
        id: 'S16',
        programmeId: 'vsdd',
        label: 'Sprint 16',
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-19T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.setCurrentCheckpoint('S16-W1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(service.closeCheckpoint('S16-W1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(service.reopenCheckpoint('S16-W1', 'reason')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(service.archiveTeam('mmm-a')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    // Nothing mutated and no audit event appended.
    expect(repo.audits).toHaveLength(0);
    expect(repo.teams.get('mmm-a')?.active).toBe(true);
  });
});
