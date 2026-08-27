/**
 * AdminService unit tests (Phase 8, task 8.2).
 *
 * Cover the approval workflow (approve/reject/assign/suspend), the state guards,
 * session revocation on reject/suspend, the audit trail, and the escalation
 * defences: a non-admin is refused, and an admin can never act on their OWN
 * account (R1.8). A password hash is never present in any response.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserAccount } from '../domain/accounts.js';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { AdminService } from './adminService.js';

const ADMIN_ID = 'admin-1';

function adminPrincipal(overrides: Partial<CurrentUser> = {}): CurrentUser {
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
    ...overrides,
  };
}

function mutableAuth(initial: CurrentUser): AuthContext & { set: (u: CurrentUser) => void } {
  let current = initial;
  return {
    getCurrentUser: () => current,
    set: (u: CurrentUser) => {
      current = u;
    },
  };
}

function pendingUser(id: string, email: string): UserAccount {
  const now = new Date().toISOString();
  return {
    id,
    email,
    displayName: `User ${id}`,
    passwordHash: '$argon2id$fake',
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };
}

let repo: InMemoryIdentityRepository;
let auth: ReturnType<typeof mutableAuth>;
let service: AdminService;

/** A reference stub knowing programme "vsdd" with active teams mmm-a / mmm-b. */
const reference = {
  getProgramme: async (id: string) =>
    id === 'vsdd' ? { id: 'vsdd', name: 'VSDD', active: true } : null,
  listTeams: async (programmeId: string) =>
    programmeId === 'vsdd'
      ? [
          { id: 'mmm-a', streamId: 'MMM', name: 'PTSB-VSDD MMM A', sortOrder: 1, active: true },
          { id: 'mmm-b', streamId: 'MMM', name: 'PTSB-VSDD MMM B', sortOrder: 2, active: true },
        ]
      : [],
};

beforeEach(async () => {
  repo = new InMemoryIdentityRepository();
  auth = mutableAuth(adminPrincipal());
  service = new AdminService({ identity: repo, reference, auth });
  await repo.insertUser({
    ...pendingUser(ADMIN_ID, 'admin@example.com'),
    status: 'ACTIVE',
  });
});

describe('AdminService.listUsers', () => {
  it('returns pending users without a password hash', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    const list = await service.listUsers('PENDING');
    expect(list.map((u) => u.id)).toContain('u1');
    expect(JSON.stringify(list)).not.toContain('passwordHash');
    expect(JSON.stringify(list)).not.toContain('$argon2id$');
  });
});

describe('AdminService.approve', () => {
  it('activates a pending user, writes the assignment and audits both events', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    const result = await service.approve('u1', {
      programmeId: 'vsdd',
      teamIds: ['mmm-a'],
      roles: ['TEAM_LEAD'],
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.roles).toEqual(['TEAM_LEAD']);
    expect(result.teamIds).toEqual(['mmm-a']);
    expect((result as unknown as Record<string, unknown>).passwordHash).toBeUndefined();

    const stored = await repo.getUserById('u1');
    expect(stored?.status).toBe('ACTIVE');
    expect(repo.auditEvents.some((e) => e.action === 'USER_APPROVED')).toBe(true);
    expect(repo.auditEvents.some((e) => e.action === 'ASSIGNMENT_CHANGED')).toBe(true);
  });

  it('requires at least one role', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await expect(
      service.approve('u1', { programmeId: 'vsdd', teamIds: [], roles: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects approving a non-pending user', async () => {
    await repo.insertUser({ ...pendingUser('u1', 'u1@example.com'), status: 'ACTIVE' });
    await expect(
      service.approve('u1', { programmeId: 'vsdd', teamIds: [], roles: ['CONTRIBUTOR'] }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('404s an unknown user', async () => {
    await expect(
      service.approve('ghost', { programmeId: 'vsdd', teamIds: [], roles: ['CONTRIBUTOR'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('AdminService.reject / suspend revoke access', () => {
  it('rejects a pending user and revokes their sessions', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await repo.createSession({
      id: 'sess-u1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const result = await service.reject('u1');
    expect(result.status).toBe('REJECTED');
    expect(await repo.getSession('sess-u1')).toBeNull();
    expect(repo.auditEvents.some((e) => e.action === 'USER_REJECTED')).toBe(true);
  });

  it('suspends an active user and revokes their sessions', async () => {
    await repo.insertUser({ ...pendingUser('u1', 'u1@example.com'), status: 'ACTIVE' });
    await repo.createSession({
      id: 'sess-u1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const result = await service.suspend('u1');
    expect(result.status).toBe('SUSPENDED');
    expect(await repo.getSession('sess-u1')).toBeNull();
    expect(repo.auditEvents.some((e) => e.action === 'USER_SUSPENDED')).toBe(true);
  });

  it('only suspends an ACTIVE user', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await expect(service.suspend('u1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('AdminService.updateAssignments', () => {
  it('modifies an active user\u2019s assignment', async () => {
    await repo.insertUser({ ...pendingUser('u1', 'u1@example.com'), status: 'ACTIVE' });
    const result = await service.updateAssignments('u1', {
      programmeId: 'vsdd',
      teamIds: ['mmm-a', 'mmm-b'],
      roles: ['CONTRIBUTOR'],
    });
    expect(result.teamIds).toEqual(['mmm-a', 'mmm-b']);
    expect(repo.auditEvents.some((e) => e.action === 'ASSIGNMENT_CHANGED')).toBe(true);
  });
});

describe('AdminService escalation defences', () => {
  it('refuses a non-admin caller (privilege escalation)', async () => {
    auth.set(adminPrincipal({ subject: 'c1', roles: ['CONTRIBUTOR'], roleLabel: 'Team Contributor' }));
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await expect(service.listUsers('PENDING')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.approve('u1', { programmeId: 'vsdd', teamIds: [], roles: ['CONTRIBUTOR'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('refuses an admin acting on their OWN account', async () => {
    await expect(
      service.approve(ADMIN_ID, { programmeId: 'vsdd', teamIds: [], roles: ['ADMIN'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.reject(ADMIN_ID)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.suspend(ADMIN_ID)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.updateAssignments(ADMIN_ID, { programmeId: 'vsdd', teamIds: [], roles: ['ADMIN'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('AdminService assignment validation (reference-checked, server-side)', () => {
  it('rejects a phantom programme', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await expect(
      service.approve('u1', { programmeId: 'ghost', teamIds: [], roles: ['LEADERSHIP'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a phantom / cross-programme team id', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await expect(
      service.approve('u1', { programmeId: 'vsdd', teamIds: ['not-a-team'], roles: ['TEAM_LEAD'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('requires at least one team for a Contributor / Team Lead', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    await expect(
      service.approve('u1', { programmeId: 'vsdd', teamIds: [], roles: ['CONTRIBUTOR'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('allows a Leadership assignment with no team (existing programme)', async () => {
    await repo.insertUser(pendingUser('u1', 'u1@example.com'));
    const result = await service.approve('u1', {
      programmeId: 'vsdd',
      teamIds: [],
      roles: ['LEADERSHIP'],
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.roles).toEqual(['LEADERSHIP']);
  });
});
