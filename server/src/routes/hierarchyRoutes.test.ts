/**
 * Unit tests for the hierarchy/identity read routes (task 7.3).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link HierarchyApi}, verifying the routing, query parsing and error-envelope
 * mapping in isolation from MongoDB. Full-stack behaviour against a real store
 * is covered by hierarchyEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '../domain/identity.js';
import type { HierarchyTree, Sprint, SprintStatus } from '../domain/hierarchy.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { HierarchyApi } from '../services/hierarchyService.js';
import { buildServer } from '../server.js';

const USER: CurrentUser = {
  subject: 'user-md',
  displayName: 'Maryna D.',
  initials: 'MD',
  roleLabel: 'Test Lead',
  roles: ['TEAM_LEAD', 'LEADERSHIP'],
  assignedTeamIds: ['mmm-a'],
  canViewAll: true,
};

const TREE: HierarchyTree = {
  programme: { id: 'vsdd', name: 'VSDD', active: true },
  streams: [
    {
      stream: { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true },
      teams: [{ id: 'mmm-a', streamId: 'MMM', name: 'PTSB-VSDD MMM A', sortOrder: 1, active: true }],
    },
  ],
};

const SPRINTS: Sprint[] = [
  { id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT' },
  { id: 'S15', programmeId: 'vsdd', label: 'Sprint 15', startDate: '2026-09-07', endDate: '2026-09-18', status: 'PLANNED' },
];

function fakeApi(overrides: Partial<HierarchyApi> = {}): HierarchyApi {
  return {
    getCurrentUser: async () => USER,
    getHierarchy: async () => TREE,
    getSprints: async (_programmeId: string, status?: SprintStatus) =>
      status ? SPRINTS.filter((s) => s.status === status) : SPRINTS,
    ...overrides,
  };
}

function build(api: HierarchyApi) {
  return buildServer(
    { checkReadiness: async () => true, hierarchy: api },
    { logLevel: 'silent' },
  );
}

describe('hierarchy read routes', () => {
  it('GET /api/v1/me returns the authenticated user', async () => {
    const app = build(fakeApi());
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ subject: 'user-md', roles: ['TEAM_LEAD', 'LEADERSHIP'] });
    await app.close();
  });

  it('GET /programmes/:id/hierarchy returns the resolved tree', async () => {
    const app = build(fakeApi());
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/hierarchy' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as HierarchyTree;
    expect(body.programme.id).toBe('vsdd');
    expect(body.streams[0]?.teams[0]?.id).toBe('mmm-a');
    await app.close();
  });

  it('passes the programmeId through to the API', async () => {
    let seen = '';
    const app = build(
      fakeApi({
        getHierarchy: async (programmeId: string) => {
          seen = programmeId;
          return TREE;
        },
      }),
    );
    await app.inject({ method: 'GET', url: '/api/v1/programmes/other/hierarchy' });
    expect(seen).toBe('other');
    await app.close();
  });

  it('GET /programmes/:id/sprints returns all sprints without a filter', async () => {
    const app = build(fakeApi());
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/sprints' });
    expect(response.statusCode).toBe(200);
    expect((response.json() as Sprint[]).map((s) => s.id)).toEqual(['S14', 'S15']);
    await app.close();
  });

  it('GET /programmes/:id/sprints?status=current filters by status', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/sprints?status=current',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Sprint[];
    expect(body).toHaveLength(1);
    expect(body[0]?.status).toBe('CURRENT');
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for an unknown status filter', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/sprints?status=bogus',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'status' }] },
    });
    // The §6 envelope always carries a correlationId (matches the OpenAPI
    // ValidationError response now documented on getSprints).
    expect(body.error.correlationId).toBeTruthy();
    await app.close();
  });

  it('maps a NOT_FOUND ApiError to a 404 error envelope', async () => {
    const app = build(
      fakeApi({
        getHierarchy: async () => {
          throw ApiError.notFound('Programme "nope" was not found.');
        },
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/nope/hierarchy' });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toMatchObject({ error: { code: 'NOT_FOUND', fieldErrors: [] } });
    expect(body.error.correlationId).toBeTruthy();
    await app.close();
  });

  it('does not register business routes when no hierarchy API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
