/**
 * Team archival preservation tests (Phase 9, task 9.6, R17.2/R17.4).
 *
 * Prove that archiving a team through {@link HierarchyAdminService} is
 * NON-DESTRUCTIVE: the team drops out of the ACTIVE hierarchy projection served
 * by {@link HierarchyService}, yet its team document and its immutable submitted
 * {@link UpdateVersion}s remain fully readable afterwards. A single combined
 * fake repository backs both services so the archive write and the subsequent
 * reads observe the same store (the guarantee the MongoDB adapter provides via a
 * shared collection set).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import type { AuditEvent, UpdatePayload, UpdateVersion } from '../domain/documents.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import { HierarchyService, type HierarchyReadPort } from './hierarchyService.js';
import {
  HierarchyAdminService,
  type HierarchyAdminRepository,
} from './hierarchyAdminService.js';

function admin(): CurrentUser {
  return {
    subject: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Ada Admin',
    initials: 'AA',
    roleLabel: 'Programme Admin',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles: ['ADMIN'],
    assignedTeamIds: [],
    canViewAll: true,
  };
}

const PAYLOAD: UpdatePayload = {
  goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
  qualityEvidence: {
    planned: 1,
    executed: 1,
    passed: 1,
    openCritical: 0,
    blocked: 0,
    automationPercent: 0,
  },
  achievements: 'a',
  aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
  exceptions: [],
  leadershipAsk: 'None',
};

function version(id: string, teamId: string): UpdateVersion {
  return {
    id,
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId,
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber: 1,
    submittedBy: 'lead-1',
    submittedAt: '2026-08-26T09:14:00Z',
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: PAYLOAD,
  };
}

/**
 * A combined in-memory store implementing both the admin write port and the
 * hierarchy read port, plus a version read, so both services share one dataset.
 */
class CombinedRepo implements HierarchyAdminRepository, HierarchyReadPort {
  programmes = new Map<string, Programme>();
  streams = new Map<string, Stream>();
  teams = new Map<string, Team>();
  sprints = new Map<string, Sprint>();
  checkpoints = new Map<string, ReportingCheckpoint>();
  versions: UpdateVersion[] = [];
  audits: AuditEvent[] = [];

  async getProgramme(id: string) {
    return this.programmes.get(id) ?? null;
  }
  async listStreams(programmeId: string) {
    return [...this.streams.values()].filter((s) => s.programmeId === programmeId);
  }
  async listTeams(programmeId: string) {
    const streamIds = new Set(
      [...this.streams.values()].filter((s) => s.programmeId === programmeId).map((s) => s.id),
    );
    return [...this.teams.values()].filter((t) => streamIds.has(t.streamId));
  }
  async listSprints(programmeId: string) {
    return [...this.sprints.values()].filter((s) => s.programmeId === programmeId);
  }
  async getStream(id: string) {
    return this.streams.get(id) ?? null;
  }
  async getTeam(id: string) {
    return this.teams.get(id) ?? null;
  }
  async getSprint(id: string) {
    return this.sprints.get(id) ?? null;
  }
  async getCheckpoint(id: string) {
    return this.checkpoints.get(id) ?? null;
  }
  async listCheckpoints(sprintId: string) {
    return [...this.checkpoints.values()].filter((c) => c.sprintId === sprintId);
  }
  async listVersions(teamId: string, checkpointId: string) {
    return this.versions.filter((v) => v.teamId === teamId && v.checkpointId === checkpointId);
  }
  async saveStreamWithAudit(stream: Stream, audit: AuditEvent) {
    this.streams.set(stream.id, { ...stream });
    this.audits.push(audit);
    return stream;
  }
  async saveTeamWithAudit(team: Team, audit: AuditEvent) {
    this.teams.set(team.id, { ...team });
    this.audits.push(audit);
    return team;
  }
  async createSprint(sprint: Sprint, checkpoints: ReportingCheckpoint[], audit: AuditEvent) {
    this.sprints.set(sprint.id, { ...sprint });
    for (const cp of checkpoints) this.checkpoints.set(cp.id, { ...cp });
    this.audits.push(audit);
    return { sprint, checkpoints };
  }
  async saveCheckpointsWithAudit(checkpoints: ReportingCheckpoint[], audit: AuditEvent) {
    for (const cp of checkpoints) this.checkpoints.set(cp.id, { ...cp });
    this.audits.push(audit);
    return checkpoints;
  }
}

let repo: CombinedRepo;
let admins: HierarchyAdminService;
let reads: HierarchyService;

beforeEach(() => {
  repo = new CombinedRepo();
  repo.programmes.set('vsdd', { id: 'vsdd', name: 'VSDD', active: true });
  repo.streams.set('MMM', { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true });
  repo.teams.set('mmm-a', { id: 'mmm-a', streamId: 'MMM', name: 'MMM A', sortOrder: 1, active: true });
  repo.teams.set('mmm-b', { id: 'mmm-b', streamId: 'MMM', name: 'MMM B', sortOrder: 2, active: true });
  // A submitted historical version for the team we will archive.
  repo.versions.push(version('mmm-a-S14-C14-1-v1', 'mmm-a'));

  const auth: AuthContext = { getCurrentUser: () => admin() };
  admins = new HierarchyAdminService({ repository: repo, auth });
  reads = new HierarchyService(repo, auth);
});

describe('team archival preserves historical records (R17.2)', () => {
  it('excludes the archived team from the active hierarchy but keeps its versions readable', async () => {
    // Precondition: the team is visible in the active hierarchy.
    const before = await reads.getHierarchy('vsdd');
    const teamsBefore = before.streams.flatMap((g) => g.teams).map((t) => t.id);
    expect(teamsBefore).toContain('mmm-a');

    await admins.archiveTeam('mmm-a');

    // Excluded from the active hierarchy projection (marked inactive).
    const after = await reads.getHierarchy('vsdd');
    const teamsAfter = after.streams.flatMap((g) => g.teams).map((t) => t.id);
    expect(teamsAfter).not.toContain('mmm-a');
    expect(teamsAfter).toContain('mmm-b');

    // The team document is retained (not deleted) and carries its archive stamp.
    const stored = await repo.getTeam('mmm-a');
    expect(stored?.active).toBe(false);
    expect(stored?.archivedAt).toBeTruthy();

    // The immutable submitted version for the archived team is still readable.
    const versions = await repo.listVersions('mmm-a', 'C14-1');
    expect(versions.map((v) => v.id)).toEqual(['mmm-a-S14-C14-1-v1']);
  });
});
