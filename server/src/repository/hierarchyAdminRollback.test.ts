/**
 * Atomic hierarchy-admin workflow rollback tests (Phase 9, task 9.5).
 *
 * Every multi-document hierarchy/reporting-cycle workflow must be all-or-nothing:
 * a failure part way through must roll everything back. These drive the
 * in-memory adapter (which implements genuine staged-commit rollback, mirroring
 * the Mongo transactions) and inject a mid-transaction failure, then assert
 * NOTHING was partially written: no partial sprint/checkpoints, no multiple/zero
 * CURRENT state, and no orphan audit event. The Mongo adapter gets the same
 * guarantee from a real transaction.
 */
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../domain/documents.js';
import type { ReportingCheckpoint, Sprint } from '../domain/hierarchy.js';
import { InMemoryHierarchyAdminRepository } from './inMemoryHierarchyAdminRepository.js';

const BOOM = new Error('injected mid-transaction failure');

function audit(action: AuditEvent['action'], entityId: string): AuditEvent {
  return {
    id: `audit-${Math.random().toString(36).slice(2)}`,
    programmeId: 'vsdd',
    aggregateId: entityId,
    entityType: 'CHECKPOINT',
    entityId,
    action,
    actorSubject: 'admin-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr',
  };
}

function sprint(id: string): Sprint {
  return {
    id,
    programmeId: 'vsdd',
    label: id,
    startDate: '2026-01-05T00:00:00.000Z',
    endDate: '2026-01-19T00:00:00.000Z',
    status: 'PLANNED',
  };
}

function checkpoint(
  id: string,
  sprintId: string,
  weekNumber: 1 | 2,
  status: ReportingCheckpoint['status'],
): ReportingCheckpoint {
  return {
    id,
    sprintId,
    weekNumber,
    opensAt: '2026-01-05T00:00:00.000Z',
    dueAt: '2026-01-12T00:00:00.000Z',
    closesAt: '2026-01-12T00:00:00.000Z',
    status,
  };
}

describe('atomic hierarchy-admin workflow rollback', () => {
  it('createSprint rolls back the sprint AND both checkpoints when the audit write fails', async () => {
    const repo = new InMemoryHierarchyAdminRepository();
    const checkpoints = [
      checkpoint('S16-W1', 'S16', 1, 'UPCOMING'),
      checkpoint('S16-W2', 'S16', 2, 'UPCOMING'),
    ];
    repo.injectedFailure = BOOM;
    await expect(
      repo.createSprint(sprint('S16'), checkpoints, audit('SPRINT_CREATED', 'S16')),
    ).rejects.toBe(BOOM);
    // No partial sprint or checkpoints, and no orphan audit event.
    expect(repo.sprints.size).toBe(0);
    expect(repo.checkpoints.size).toBe(0);
    expect(repo.auditEvents).toHaveLength(0);

    // A retry (no injected failure) succeeds cleanly.
    await repo.createSprint(sprint('S16'), checkpoints, audit('SPRINT_CREATED', 'S16'));
    expect(repo.sprints.size).toBe(1);
    expect(repo.checkpoints.size).toBe(2);
    expect(repo.auditEvents).toHaveLength(1);
  });

  it('set-current rolls back so exactly one CURRENT remains and no orphan audit is left', async () => {
    const repo = new InMemoryHierarchyAdminRepository();
    // Seed: W1 CURRENT, W2 UPCOMING (exactly one CURRENT).
    repo.checkpoints.set('S16-W1', checkpoint('S16-W1', 'S16', 1, 'CURRENT'));
    repo.checkpoints.set('S16-W2', checkpoint('S16-W2', 'S16', 2, 'UPCOMING'));
    repo.injectedFailure = BOOM;
    // The "make W2 current" write demotes W1 -> CLOSED and promotes W2 -> CURRENT.
    await expect(
      repo.saveCheckpointsWithAudit(
        [
          checkpoint('S16-W2', 'S16', 2, 'CURRENT'),
          checkpoint('S16-W1', 'S16', 1, 'CLOSED'),
        ],
        audit('CHECKPOINT_CHANGED', 'S16-W2'),
      ),
    ).rejects.toBe(BOOM);
    // Prior state intact: still exactly one CURRENT (W1), never multiple/zero.
    const current = [...repo.checkpoints.values()].filter((c) => c.status === 'CURRENT');
    expect(current.map((c) => c.id)).toEqual(['S16-W1']);
    expect(repo.checkpoints.get('S16-W2')?.status).toBe('UPCOMING');
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('close rolls back to the prior status with no orphan audit event', async () => {
    const repo = new InMemoryHierarchyAdminRepository();
    repo.checkpoints.set('S16-W1', checkpoint('S16-W1', 'S16', 1, 'CURRENT'));
    repo.injectedFailure = BOOM;
    await expect(
      repo.saveCheckpointsWithAudit(
        [checkpoint('S16-W1', 'S16', 1, 'CLOSED')],
        audit('CHECKPOINT_CHANGED', 'S16-W1'),
      ),
    ).rejects.toBe(BOOM);
    expect(repo.checkpoints.get('S16-W1')?.status).toBe('CURRENT');
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('reopen rolls back a closed window with no orphan audit event', async () => {
    const repo = new InMemoryHierarchyAdminRepository();
    repo.checkpoints.set('S16-W1', checkpoint('S16-W1', 'S16', 1, 'CLOSED'));
    repo.injectedFailure = BOOM;
    await expect(
      repo.saveCheckpointsWithAudit(
        [checkpoint('S16-W1', 'S16', 1, 'CURRENT')],
        audit('CHECKPOINT_CHANGED', 'S16-W1'),
      ),
    ).rejects.toBe(BOOM);
    expect(repo.checkpoints.get('S16-W1')?.status).toBe('CLOSED');
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('saveStreamWithAudit / saveTeamWithAudit roll back the config write on audit failure', async () => {
    const repo = new InMemoryHierarchyAdminRepository();
    repo.injectedFailure = BOOM;
    await expect(
      repo.saveStreamWithAudit(
        { id: 'GRMB', programmeId: 'vsdd', name: 'GRMB', sortOrder: 0, active: true },
        audit('HIERARCHY_CHANGED', 'GRMB'),
      ),
    ).rejects.toBe(BOOM);
    expect(repo.streams.size).toBe(0);
    expect(repo.auditEvents).toHaveLength(0);
  });
});
