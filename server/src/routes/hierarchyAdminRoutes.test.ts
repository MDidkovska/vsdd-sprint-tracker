/**
 * Hierarchy-admin route tests (Phase 9, task 9.5).
 *
 * Builds the Fastify server with the real {@link HierarchyAdminService} wired to
 * an in-memory reference/config repository and injects requests. Proves the
 * happy paths return the created resource (201), that a non-admin principal is
 * refused with a 403 PERMISSION_DENIED envelope (default-deny enforced in the
 * service), and that malformed bodies and phantom ids map to a 400
 * VALIDATION_FAILED envelope.
 */
import { describe, expect, it } from 'vitest';
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
import { buildServer } from '../server.js';
import {
  HierarchyAdminService,
  type HierarchyAdminRepository,
} from '../services/hierarchyAdminService.js';

function principal(overrides: Partial<CurrentUser> = {}): CurrentUser {
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

class FakeRepo implements HierarchyAdminRepository {
  programmes = new Map<string, Programme>([['vsdd', { id: 'vsdd', name: 'VSDD', active: true }]]);
  streams = new Map<string, Stream>([
    ['MMM', { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true }],
  ]);
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
  async createSprint(
    sprint: Sprint,
    checkpoints: ReportingCheckpoint[],
    audit: AuditEvent,
  ) {
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

function build(user: CurrentUser, repo = new FakeRepo()) {
  const auth: AuthContext = { getCurrentUser: () => user };
  const service = new HierarchyAdminService({ repository: repo, auth });
  const app = buildServer(
    { checkReadiness: async () => true, hierarchyAdmin: service },
    { logLevel: 'silent' },
  );
  return { app, repo };
}

describe('hierarchy-admin routes', () => {
  it('POST /admin/streams returns 201 with the created stream', async () => {
    const { app } = build(principal());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      payload: { id: 'GRMB', programmeId: 'vsdd', name: 'GRMB' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe('GRMB');
    await app.close();
  });

  it('POST /admin/sprints returns 201 with two weekly checkpoints', async () => {
    const { app } = build(principal());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/sprints',
      payload: {
        id: 'S16',
        programmeId: 'vsdd',
        label: 'Sprint 16',
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-19T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().checkpoints).toHaveLength(2);
    await app.close();
  });

  it('refuses a non-admin caller with 403 PERMISSION_DENIED', async () => {
    const { app } = build(principal({ roles: ['CONTRIBUTOR'], roleLabel: 'Contributor' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      payload: { id: 'X', programmeId: 'vsdd', name: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    await app.close();
  });

  it('maps a malformed body to a 400 VALIDATION_FAILED envelope', async () => {
    const { app } = build(principal());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      payload: { programmeId: 'vsdd' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('maps a phantom programme to a 400 VALIDATION_FAILED envelope', async () => {
    const { app } = build(principal());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/streams',
      payload: { id: 'X', programmeId: 'ghost', name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('POST /admin/teams/:id/archive returns 200 with the archived (inactive) team', async () => {
    const repo = new FakeRepo();
    repo.teams.set('mmm-a', { id: 'mmm-a', streamId: 'MMM', name: 'MMM A', sortOrder: 1, active: true });
    const { app } = build(principal(), repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/mmm-a/archive',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.active).toBe(false);
    expect(body.archivedAt).toBeTruthy();
    await app.close();
  });

  it('refuses archiving for a non-admin caller with 403 PERMISSION_DENIED', async () => {
    const repo = new FakeRepo();
    repo.teams.set('mmm-a', { id: 'mmm-a', streamId: 'MMM', name: 'MMM A', sortOrder: 1, active: true });
    const { app } = build(principal({ roles: ['CONTRIBUTOR'], roleLabel: 'Contributor' }), repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/mmm-a/archive',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
    await app.close();
  });

  it('maps a phantom team id on archive to a 400 VALIDATION_FAILED envelope', async () => {
    const { app } = build(principal());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/ghost/archive',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  it('POST /admin/checkpoints/:id/reopen requires a reason (400)', async () => {
    const repo = new FakeRepo();
    repo.checkpoints.set('S16-W1', {
      id: 'S16-W1',
      sprintId: 'S16',
      weekNumber: 1,
      opensAt: '2026-01-05T00:00:00.000Z',
      dueAt: '2026-01-12T00:00:00.000Z',
      closesAt: '2026-01-12T00:00:00.000Z',
      status: 'CLOSED',
    });
    const { app } = build(principal(), repo);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/checkpoints/S16-W1/reopen',
      payload: { reason: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
