/**
 * Team Contributor / Team Lead scoping tests (Phase 8, task 8.3).
 *
 * Proves the draft (edit) and submit services enforce team + role scoping
 * server-side: a Contributor/Lead may only act on an ASSIGNED team, only a Team
 * Lead may submit, and Leadership (a viewer role) may read but not edit. These
 * are the negative-authorisation tests for the write endpoints.
 */
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser, Role } from '../domain/identity.js';
import type { ReportingCheckpoint, Sprint, Team } from '../domain/hierarchy.js';
import type { UpdateDocument } from '../domain/documents.js';
import type {
  SaveDraftInput,
  SubmitDraftInput,
  SubmitOutcome,
  WriteOutcome,
} from '../repository/documentRepository.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { SubmitService } from './submitService.js';

const TEAM: Team = { id: 'mmm-a', streamId: 'MMM', name: 'PTSB-VSDD MMM A', sortOrder: 1, active: true };
const CHECKPOINT: ReportingCheckpoint = {
  id: 'C14-1', sprintId: 'S14', weekNumber: 1,
  opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT',
};
const SPRINT: Sprint = {
  id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT',
};

function authFor(
  roles: Role[],
  assignedTeamIds: string[],
  canViewAll = false,
  programmeId: string | null = 'vsdd',
): AuthContext {
  const user: CurrentUser = {
    subject: 'u1',
    email: 'u1@example.com',
    displayName: 'U One',
    initials: 'UO',
    roleLabel: 'x',
    status: 'ACTIVE',
    programmeId,
    roles,
    assignedTeamIds,
    canViewAll,
  };
  return { getCurrentUser: () => user };
}

/** Minimal repo that returns the fixtures and accepts writes. */
function fakeRepo() {
  return {
    getTeam: async (id: string) => (id === TEAM.id ? TEAM : null),
    getCheckpoint: async (id: string) => (id === CHECKPOINT.id ? CHECKPOINT : null),
    getSprint: async (id: string) => (id === SPRINT.id ? SPRINT : null),
    getDraft: async () => null,
    saveDraft: async (input: SaveDraftInput): Promise<WriteOutcome<UpdateDocument>> => ({
      ok: true,
      document: { ...(input.document as UpdateDocument), revision: input.expectedRevision + 1 },
    }),
    listVersions: async () => [],
    submitUpdate: async (_input: SubmitDraftInput): Promise<SubmitOutcome> => {
      throw new Error('should not reach submitUpdate in a denial test');
    },
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

describe('DraftService team scoping', () => {
  it('lets an assigned Contributor save a draft', async () => {
    const service = new DraftService(fakeRepo(), authFor(['CONTRIBUTOR'], ['mmm-a']));
    const doc = await service.saveDraft('mmm-a', 'C14-1', REQUEST);
    expect(doc.teamId).toBe('mmm-a');
  });

  it('denies a Contributor saving an UNASSIGNED team', async () => {
    const service = new DraftService(fakeRepo(), authFor(['CONTRIBUTOR'], ['mmm-b']));
    await expect(service.saveDraft('mmm-a', 'C14-1', REQUEST)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('denies a Leadership viewer editing a draft (not an editor role)', async () => {
    const service = new DraftService(fakeRepo(), authFor(['LEADERSHIP'], [], true));
    await expect(service.saveDraft('mmm-a', 'C14-1', REQUEST)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('lets a Leadership viewer READ any team update', async () => {
    const service = new DraftService(fakeRepo(), authFor(['LEADERSHIP'], [], true));
    const doc = await service.getUpdate('mmm-a', 'C14-1');
    expect(doc.state).toBe('MISSING');
  });

  it('denies a Contributor reading an UNASSIGNED team update', async () => {
    const service = new DraftService(fakeRepo(), authFor(['CONTRIBUTOR'], ['mmm-b']));
    await expect(service.getUpdate('mmm-a', 'C14-1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});

describe('SubmitService team + lead scoping', () => {
  it('denies a Contributor submitting (not a Team Lead)', async () => {
    const service = new SubmitService(fakeRepo(), authFor(['CONTRIBUTOR'], ['mmm-a']));
    await expect(service.submit('mmm-a', 'C14-1', REQUEST)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('denies a Team Lead submitting an UNASSIGNED team', async () => {
    const service = new SubmitService(fakeRepo(), authFor(['TEAM_LEAD'], ['mmm-b']));
    await expect(service.submit('mmm-a', 'C14-1', REQUEST)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});
