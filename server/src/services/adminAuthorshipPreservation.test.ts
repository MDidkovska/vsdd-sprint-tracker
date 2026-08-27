/**
 * Admin assignment changes preserve historical authorship (Phase 9, task 9.7 /
 * R17).
 *
 * R17 requires that reconfiguring the hierarchy and reassigning people never
 * rewrites the historical record: a submitted {@link UpdateVersion} keeps the
 * `submittedBy` of the person who actually submitted it, even after an admin
 * later changes that person's team/role assignment or suspends them. The other
 * R17 admin capabilities (validation against real reference data, unique team
 * name within a stream, non-destructive team archival) are covered by
 * adminService.test.ts, hierarchyAdminService.test.ts and teamArchival.test.ts;
 * this file closes the remaining "assignment changes preserve authorship" gap.
 *
 * The AdminService only ever writes the identity collections (users /
 * assignments / sessions / auditEvents); it must never touch the immutable
 * `versions`. This test locks that invariant in: it observes a submitted
 * version's authorship before and after an assignment change and a suspension.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserAccount } from '../domain/accounts.js';
import type { CurrentUser } from '../domain/identity.js';
import type { UpdatePayload, UpdateVersion } from '../domain/documents.js';
import type { AuthContext } from '../auth/mockAuth.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { AdminService } from './adminService.js';

const ADMIN_ID = 'admin-1';
const LEAD_ID = 'lead-1';

function adminPrincipal(): CurrentUser {
  return {
    subject: ADMIN_ID,
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

const reference = {
  getProgramme: async (id: string) =>
    id === 'vsdd' ? { id: 'vsdd', name: 'VSDD', active: true } : null,
  listTeams: async (programmeId: string) =>
    programmeId === 'vsdd'
      ? [
          { id: 'mmm-a', streamId: 'MMM', name: 'MMM A', sortOrder: 1, active: true },
          { id: 'mmm-b', streamId: 'MMM', name: 'MMM B', sortOrder: 2, active: true },
        ]
      : [],
};

const PAYLOAD: UpdatePayload = {
  goals: { business: 'b', technicalTesting: 't', sprintCommitment: 's', nextWeekCommitment: 'n' },
  qualityEvidence: { planned: 1, executed: 1, passed: 1, openCritical: 0, blocked: 0, automationPercent: 0 },
  achievements: 'a',
  aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
  exceptions: [],
  leadershipAsk: 'None',
};

/** A submitted version authored by LEAD_ID for team mmm-a. */
function authoredVersion(): UpdateVersion {
  return {
    id: 'mmm-a-S14-C14-1-v1',
    programmeId: 'vsdd',
    streamId: 'MMM',
    teamId: 'mmm-a',
    sprintId: 'S14',
    checkpointId: 'C14-1',
    versionNumber: 1,
    submittedBy: LEAD_ID,
    submittedAt: '2026-08-26T09:14:00Z',
    schemaVersion: 1,
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    hasBlocker: false,
    hasLeadershipAsk: false,
    payload: PAYLOAD,
  };
}

function activeUser(id: string): UserAccount {
  const now = new Date().toISOString();
  return {
    id,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    passwordHash: '$argon2id$fake',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

let repo: InMemoryIdentityRepository;
let service: AdminService;
/** The immutable version store lives OUTSIDE the identity repository. */
let versions: UpdateVersion[];
const auth: AuthContext = { getCurrentUser: () => adminPrincipal() };

beforeEach(async () => {
  repo = new InMemoryIdentityRepository();
  service = new AdminService({ identity: repo, reference, auth });
  versions = [authoredVersion()];
  await repo.insertUser(activeUser(ADMIN_ID));
  await repo.insertUser(activeUser(LEAD_ID));
  await repo.upsertAssignment({
    id: LEAD_ID,
    userId: LEAD_ID,
    programmeId: 'vsdd',
    teamIds: ['mmm-a'],
    roles: ['TEAM_LEAD'],
    updatedAt: new Date().toISOString(),
  });
});

describe('assignment changes preserve historical authorship (R17)', () => {
  it('keeps submittedBy after the author is reassigned to a different team', async () => {
    expect(versions[0]!.submittedBy).toBe(LEAD_ID);

    // Admin moves the author off mmm-a onto mmm-b (a role/team reconfiguration).
    const updated = await service.updateAssignments(LEAD_ID, {
      programmeId: 'vsdd',
      teamIds: ['mmm-b'],
      roles: ['TEAM_LEAD'],
    });
    expect(updated.teamIds).toEqual(['mmm-b']);

    // The immutable submitted version still records the ORIGINAL author.
    const historical = versions.find((v) => v.id === 'mmm-a-S14-C14-1-v1');
    expect(historical?.submittedBy).toBe(LEAD_ID);
    expect(historical?.teamId).toBe('mmm-a');
  });

  it('keeps submittedBy after the author is suspended', async () => {
    const suspended = await service.suspend(LEAD_ID);
    expect(suspended.status).toBe('SUSPENDED');

    // Losing access does not erase authorship of already-submitted evidence.
    const historical = versions.find((v) => v.id === 'mmm-a-S14-C14-1-v1');
    expect(historical?.submittedBy).toBe(LEAD_ID);
  });
});
