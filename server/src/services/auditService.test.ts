/**
 * AuditQueryService tests (Phase 8 repair): authorization, newest-first order,
 * filters, pagination, and sanitisation (no free-text / secret fields).
 */
import { describe, expect, it } from 'vitest';
import type { AuditAction, AuditEvent } from '../domain/documents.js';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser, Role } from '../domain/identity.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { AuditQueryService } from './auditService.js';

function principal(roles: Role[]): CurrentUser {
  return {
    subject: 'actor',
    email: 'actor@example.com',
    displayName: 'Actor',
    initials: 'A',
    roleLabel: 'x',
    status: 'ACTIVE',
    programmeId: 'vsdd',
    roles,
    assignedTeamIds: [],
    canViewAll: true,
  };
}

function authFor(roles: Role[]): AuthContext {
  return { getCurrentUser: () => principal(roles) };
}

let seq = 0;
function event(action: AuditAction, aggregateId: string, extra: Partial<AuditEvent> = {}): AuditEvent {
  seq += 1;
  return {
    id: `a-${seq}`,
    programmeId: 'system',
    aggregateId,
    entityType: 'USER',
    entityId: aggregateId,
    action,
    actorSubject: 'admin-1',
    timestamp: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    correlationId: `c-${seq}`,
    ...extra,
  };
}

async function seededRepo() {
  const repo = new InMemoryIdentityRepository();
  await repo.appendAudit(event('USER_REGISTERED', 'user-1'));
  await repo.appendAudit(event('USER_APPROVED', 'user-1'));
  await repo.appendAudit(event('ASSIGNMENT_CHANGED', 'user-1'));
  await repo.appendAudit(event('USER_REGISTERED', 'user-2'));
  // A reopen event carries a user-authored reason — it must never leak.
  await repo.appendAudit(
    event('REOPENED', 'mmm-a|S14|C14-1', { entityType: 'UPDATE', reason: 'SECRET REOPEN REASON' }),
  );
  return repo;
}

describe('AuditQueryService', () => {
  it('denies a non-admin/non-auditor caller', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['LEADERSHIP']));
    await expect(svc.list({})).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('allows an auditor and returns newest-first', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['AUDITOR']));
    const page = await svc.list({});
    expect(page.total).toBe(5);
    // Newest-first: the last appended event (REOPENED) is first.
    expect(page.items[0]?.action).toBe('REOPENED');
  });

  it('filters by action', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['ADMIN']));
    const page = await svc.list({ action: 'USER_REGISTERED' });
    expect(page.total).toBe(2);
    expect(page.items.every((e) => e.action === 'USER_REGISTERED')).toBe(true);
  });

  it('filters by userId (aggregate)', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['ADMIN']));
    const page = await svc.list({ userId: 'user-1' });
    expect(page.total).toBe(3);
    expect(page.items.every((e) => e.aggregateId === 'user-1')).toBe(true);
  });

  it('paginates with limit/offset', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['ADMIN']));
    const first = await svc.list({ limit: 2, offset: 0 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    const second = await svc.list({ limit: 2, offset: 2 });
    expect(second.items).toHaveLength(2);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it('never exposes reason/filterSummary or any user-authored content', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['ADMIN']));
    const page = await svc.list({ action: 'REOPENED' });
    const json = JSON.stringify(page);
    expect(json).not.toContain('SECRET REOPEN REASON');
    expect(json).not.toContain('reason');
    expect(json).not.toContain('filterSummary');
    // The sanitised row exposes only stable metadata.
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      ['action', 'actorSubject', 'aggregateId', 'correlationId', 'entityId', 'entityType', 'id', 'timestamp'].sort(),
    );
  });

  it('rejects an unknown action filter', async () => {
    const repo = await seededRepo();
    const svc = new AuditQueryService(repo, authFor(['ADMIN']));
    await expect(svc.list({ action: 'NOPE' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
