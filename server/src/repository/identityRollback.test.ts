/**
 * Atomic identity-workflow rollback tests (Phase 8 repair).
 *
 * Every multi-write identity workflow must be all-or-nothing: a failure part way
 * through must roll everything back. These drive the in-memory adapter (which
 * implements genuine staged-commit rollback, mirroring the Mongo transactions)
 * and inject a mid-transaction failure, then assert NOTHING was partially
 * written. The Mongo adapter gets the same guarantee from a real transaction.
 */
import { describe, expect, it } from 'vitest';
import type { Assignment, SessionRecord, UserAccount } from '../domain/accounts.js';
import type { AuditEvent } from '../domain/documents.js';
import { InMemoryIdentityRepository } from './inMemoryIdentityRepository.js';

function user(id: string, status: UserAccount['status']): UserAccount {
  const now = new Date().toISOString();
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    passwordHash: '$argon2id$fake',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function assignment(userId: string, roles: Assignment['roles'], teamIds: string[]): Assignment {
  return { id: userId, userId, programmeId: 'vsdd', teamIds, roles, updatedAt: new Date().toISOString() };
}

function audit(action: AuditEvent['action'], entityId: string): AuditEvent {
  return {
    id: `audit-${Math.random().toString(36).slice(2)}`,
    programmeId: 'system',
    aggregateId: entityId,
    entityType: 'USER',
    entityId,
    action,
    actorSubject: 'admin-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr',
  };
}

const BOOM = new Error('injected mid-transaction failure');

describe('atomic identity workflow rollback', () => {
  it('createUserWithAudit rolls back the user when the audit write fails', async () => {
    const repo = new InMemoryIdentityRepository();
    repo.injectedFailure = BOOM;
    await expect(
      repo.createUserWithAudit({ user: user('u1', 'PENDING'), audit: audit('USER_REGISTERED', 'u1') }),
    ).rejects.toBe(BOOM);
    expect(await repo.getUserById('u1')).toBeNull();
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('approveUserWithAssignment rolls back status + assignment when the audit fails', async () => {
    const repo = new InMemoryIdentityRepository();
    await repo.insertUser(user('u1', 'PENDING'));
    repo.injectedFailure = BOOM;
    await expect(
      repo.approveUserWithAssignment({
        userId: 'u1',
        status: 'ACTIVE',
        updatedAt: new Date().toISOString(),
        assignment: assignment('u1', ['TEAM_LEAD'], ['mmm-a']),
        audits: [audit('USER_APPROVED', 'u1'), audit('ASSIGNMENT_CHANGED', 'u1')],
      }),
    ).rejects.toBe(BOOM);
    // Nothing persisted: still PENDING, still no assignment, no audit.
    expect((await repo.getUserById('u1'))?.status).toBe('PENDING');
    expect(await repo.getAssignment('u1')).toBeNull();
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('changeUserStatusWithAudit rolls back status + session revocation on failure', async () => {
    const repo = new InMemoryIdentityRepository();
    await repo.insertUser(user('u1', 'ACTIVE'));
    const session: SessionRecord = {
      id: 'sess-1',
      userId: 'u1',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    await repo.createSession(session);
    repo.injectedFailure = BOOM;
    await expect(
      repo.changeUserStatusWithAudit({
        userId: 'u1',
        status: 'SUSPENDED',
        updatedAt: new Date().toISOString(),
        audit: audit('USER_SUSPENDED', 'u1'),
        revokeSessions: true,
      }),
    ).rejects.toBe(BOOM);
    // Still ACTIVE and the session was restored (revocation rolled back).
    expect((await repo.getUserById('u1'))?.status).toBe('ACTIVE');
    expect(await repo.getSession('sess-1')).not.toBeNull();
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('updateAssignmentWithAudit rolls back to the prior assignment on failure', async () => {
    const repo = new InMemoryIdentityRepository();
    await repo.insertUser(user('u1', 'ACTIVE'));
    await repo.upsertAssignment(assignment('u1', ['CONTRIBUTOR'], ['mmm-a']));
    repo.injectedFailure = BOOM;
    await expect(
      repo.updateAssignmentWithAudit({
        assignment: assignment('u1', ['TEAM_LEAD'], ['mmm-a', 'mmm-b']),
        audit: audit('ASSIGNMENT_CHANGED', 'u1'),
      }),
    ).rejects.toBe(BOOM);
    const current = await repo.getAssignment('u1');
    expect(current?.roles).toEqual(['CONTRIBUTOR']);
    expect(current?.teamIds).toEqual(['mmm-a']);
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('createAdminAtomically rolls back the user + assignment when the audit fails (bootstrap retryable)', async () => {
    const repo = new InMemoryIdentityRepository();
    repo.injectedFailure = BOOM;
    await expect(
      repo.createAdminAtomically({
        user: user('admin-1', 'ACTIVE'),
        assignment: assignment('admin-1', ['ADMIN'], []),
        audit: audit('ADMIN_BOOTSTRAPPED', 'admin-1'),
      }),
    ).rejects.toBe(BOOM);
    // No ACTIVE admin left without an assignment — nothing persisted at all.
    expect(await repo.getUserById('admin-1')).toBeNull();
    expect(await repo.getAssignment('admin-1')).toBeNull();
    expect(repo.auditEvents).toHaveLength(0);

    // ...and a retry (no injected failure) succeeds cleanly.
    await repo.createAdminAtomically({
      user: user('admin-1', 'ACTIVE'),
      assignment: assignment('admin-1', ['ADMIN'], []),
      audit: audit('ADMIN_BOOTSTRAPPED', 'admin-1'),
    });
    expect((await repo.getUserById('admin-1'))?.status).toBe('ACTIVE');
    expect((await repo.getAssignment('admin-1'))?.roles).toEqual(['ADMIN']);
  });
});
