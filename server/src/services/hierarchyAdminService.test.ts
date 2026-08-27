/**
 * HierarchyAdminService unit tests (Phase 9, task 9.5).
 *
 * Cover the configuration workflows (create/update stream + team, create sprint
 * with its two weekly checkpoints, and the checkpoint window transitions) plus
 * the invariants required by R2 and R17: exactly two weekly checkpoints, exactly
 * one CURRENT checkpoint, a closed window cannot be made current, reopening
 * requires a reason, team names are unique within a stream for the active
 * period, and phantom / cross-programme ids are rejected. Authorisation is
 * default-deny: a non-admin caller is refused. Every change appends an audit
 * event carrying stable ids only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import type { AuditEvent } from '../domain/documents.js';
import type {
  Programme,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../domain/hierarchy.js';
import { HierarchyAdminService, type HierarchyAdminRepository } from './hierarchyAdminService.js';

function adminPrincipal(overrides: Partial<CurrentUser> = {}): CurrentUser {
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
    ...overrides,
  };
}

function mutableAuth(initial: CurrentUser): AuthContext & { set: (u: CurrentUser) => void } {
  let current = initial;
  return {
    getCurrentUser: () => current,
    set: (u) => {
      current = u;
    },
  };
}

/** In-memory reference/config repository fake implementing the narrow port. */
class FakeRepo implements HierarchyAdminRepository {
  programmes = new Map<string, Programme>();
  streams = new Map<string, Stream>();
  teams = new Map<string, Team>();
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
    this.streams.set(stream.id, { ...stream });
    this.audits.push(audit);
    return stream;
  }
  async getTeam(id: string) {
    return this.teams.get(id) ?? null;
  }
  async listTeams(programmeId: string) {
    const streamIds = new Set(
      [...this.streams.values()].filter((s) => s.programmeId === programmeId).map((s) => s.id),
    );
    return [...this.teams.values()].filter((t) => streamIds.has(t.streamId));
  }
  async saveTeamWithAudit(team: Team, audit: AuditEvent) {
    this.teams.set(team.id, { ...team });
    this.audits.push(audit);
    return team;
  }
  async getSprint(id: string) {
    return this.sprints.get(id) ?? null;
  }
  async createSprint(
    sprint: Sprint,
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ) {
    if (this.sprints.has(sprint.id)) {
      throw new Error('duplicate sprint');
    }
    this.sprints.set(sprint.id, { ...sprint });
    for (const cp of checkpoints) this.checkpoints.set(cp.id, { ...cp });
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
    for (const cp of checkpoints) this.checkpoints.set(cp.id, { ...cp });
    this.audits.push(audit);
    return checkpoints;
  }
}

let repo: FakeRepo;
let auth: ReturnType<typeof mutableAuth>;
let service: HierarchyAdminService;

beforeEach(() => {
  repo = new FakeRepo();
  repo.programmes.set('vsdd', { id: 'vsdd', name: 'VSDD', active: true });
  repo.programmes.set('other', { id: 'other', name: 'Other', active: true });
  repo.streams.set('MMM', { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true });
  repo.streams.set('OTHER-S', {
    id: 'OTHER-S',
    programmeId: 'other',
    name: 'Other Stream',
    sortOrder: 1,
    active: true,
  });
  auth = mutableAuth(adminPrincipal());
  service = new HierarchyAdminService({ repository: repo, auth });
});

describe('HierarchyAdminService streams', () => {
  it('creates a stream and audits HIERARCHY_CHANGED', async () => {
    const stream = await service.createStream({ id: 'GRMB', programmeId: 'vsdd', name: 'GRMB' });
    expect(stream.active).toBe(true);
    expect(repo.streams.get('GRMB')).toBeTruthy();
    expect(repo.audits.some((e) => e.action === 'HIERARCHY_CHANGED' && e.entityType === 'STREAM')).toBe(true);
  });

  it('rejects a phantom programme', async () => {
    await expect(
      service.createStream({ id: 'X', programmeId: 'ghost', name: 'X' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('HierarchyAdminService teams', () => {
  it('creates a team within its stream', async () => {
    const team = await service.createTeam({
      id: 'mmm-a',
      programmeId: 'vsdd',
      streamId: 'MMM',
      name: 'MMM A',
    });
    expect(team.streamId).toBe('MMM');
    expect(repo.audits.some((e) => e.entityType === 'TEAM')).toBe(true);
  });

  it('enforces a unique active team name within the stream', async () => {
    await service.createTeam({ id: 'mmm-a', programmeId: 'vsdd', streamId: 'MMM', name: 'MMM A' });
    await expect(
      service.createTeam({ id: 'mmm-a2', programmeId: 'vsdd', streamId: 'MMM', name: 'mmm a' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('allows reusing the name of an archived (inactive) team', async () => {
    repo.teams.set('old', { id: 'old', streamId: 'MMM', name: 'MMM A', sortOrder: 1, active: false });
    const team = await service.createTeam({
      id: 'mmm-a',
      programmeId: 'vsdd',
      streamId: 'MMM',
      name: 'MMM A',
    });
    expect(team.id).toBe('mmm-a');
  });

  it('rejects a cross-programme stream id', async () => {
    await expect(
      service.createTeam({ id: 't', programmeId: 'vsdd', streamId: 'OTHER-S', name: 'T' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('HierarchyAdminService sprints + checkpoints', () => {
  it('creates a sprint with exactly two weekly checkpoints', async () => {
    const { sprint, checkpoints } = await service.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    expect(sprint.status).toBe('PLANNED');
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.map((c) => c.weekNumber).sort()).toEqual([1, 2]);
    expect(checkpoints.every((c) => c.status === 'UPCOMING')).toBe(true);
    expect(repo.audits.some((e) => e.action === 'SPRINT_CREATED')).toBe(true);
  });

  it('rejects an end date before the start date', async () => {
    await expect(
      service.createSprint({
        id: 'S17',
        programmeId: 'vsdd',
        label: 'bad',
        startDate: '2026-02-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('keeps exactly one CURRENT checkpoint when setting current', async () => {
    await service.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    await service.setCurrentCheckpoint('S16-W1');
    await service.setCurrentCheckpoint('S16-W2');
    const cps = await repo.listCheckpoints('S16');
    expect(cps.filter((c) => c.status === 'CURRENT').map((c) => c.id)).toEqual(['S16-W2']);
  });

  it('refuses making a CLOSED window current (WINDOW_CLOSED)', async () => {
    await service.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    await service.closeCheckpoint('S16-W1');
    await expect(service.setCurrentCheckpoint('S16-W1')).rejects.toMatchObject({
      code: 'WINDOW_CLOSED',
    });
  });

  it('requires a reason to reopen a closed window', async () => {
    await service.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    await service.closeCheckpoint('S16-W1');
    await expect(service.reopenCheckpoint('S16-W1', '   ')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const reopened = await service.reopenCheckpoint('S16-W1', 'Late submission agreed');
    expect(reopened.status).toBe('CURRENT');
    const reopenAudit = repo.audits.find(
      (e) => e.action === 'CHECKPOINT_CHANGED' && e.reason === 'Late submission agreed',
    );
    expect(reopenAudit).toBeTruthy();
  });

  it('only reopens a CLOSED window', async () => {
    await service.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    await expect(service.reopenCheckpoint('S16-W1', 'reason')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});

describe('HierarchyAdminService authorisation (default-deny)', () => {
  beforeEach(() => {
    auth.set(adminPrincipal({ subject: 'c1', roles: ['CONTRIBUTOR'], roleLabel: 'Contributor' }));
  });

  it('refuses a non-admin caller on every operation', async () => {
    await expect(
      service.createStream({ id: 'X', programmeId: 'vsdd', name: 'X' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.createTeam({ id: 't', programmeId: 'vsdd', streamId: 'MMM', name: 'T' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      service.createSprint({
        id: 'S16',
        programmeId: 'vsdd',
        label: 'x',
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-19T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.setCurrentCheckpoint('S16-W1')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});
