/**
 * Full-stack integration tests for the hierarchy/reporting-cycle read endpoints
 * (task 7.3).
 *
 * These wire the REAL MongoDB adapter (via mongodb-memory-server, or a
 * docker-compose instance through MONGO_TEST_URI) to the real
 * {@link HierarchyService} and the Fastify server, then exercise the endpoints
 * with `inject`. They verify the whole slice: seeding, vendor-neutral reads,
 * tree assembly, status filtering and the §6 error envelope — including empty
 * and not-found cases.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mockAuthContext } from '../auth/mockAuth.js';
import type { HierarchyTree, Sprint } from '../domain/hierarchy.js';
import type { CurrentUser } from '../domain/identity.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { HierarchyService } from './hierarchyService.js';

let memoryServer: MongoMemoryServer | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_hierarchy_test';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });

  // Seed twice to prove the seed is idempotent (no duplicate documents).
  await repository.seedReferenceData(buildReferenceData());
  await repository.seedReferenceData(buildReferenceData());

  const hierarchy = new HierarchyService(repository, mockAuthContext);
  app = buildServer({ checkReadiness: () => repository.ping(), hierarchy }, { logLevel: 'silent' });
});

afterAll(async () => {
  await app?.close();
  await repository?.close();
  await memoryServer?.stop();
});

describe('GET /api/v1/me', () => {
  it('returns the mocked authenticated user and team assignments', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(response.statusCode).toBe(200);
    const user = response.json() as CurrentUser;
    expect(user.subject).toBe('user-md');
    expect(user.canViewAll).toBe(true);
    // o24-desktop is intentionally unassigned (read-only demonstration).
    expect(user.assignedTeamIds).not.toContain('o24-desktop');
    expect(user.assignedTeamIds).toContain('mmm-a');
  });
});

describe('GET /api/v1/programmes/:programmeId/hierarchy', () => {
  it('returns the Programme -> Stream -> Team tree in sort order', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/hierarchy' });
    expect(response.statusCode).toBe(200);
    const tree = response.json() as HierarchyTree;

    expect(tree.programme).toMatchObject({ id: 'vsdd', name: 'VSDD' });
    expect(tree.streams.map((s) => s.stream.id)).toEqual(['MMM', 'OAH', 'GRMB', 'O24', 'Visa']);

    const mmm = tree.streams.find((s) => s.stream.id === 'MMM');
    expect(mmm?.teams.map((t) => t.id)).toEqual(['mmm-a', 'mmm-b']);

    // Every listed team belongs to its stream and is active.
    for (const group of tree.streams) {
      for (const team of group.teams) {
        expect(team.streamId).toBe(group.stream.id);
        expect(team.active).toBe(true);
      }
    }
  });

  it('does not duplicate documents after repeated seeding', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/hierarchy' });
    const tree = response.json() as HierarchyTree;
    const teamIds = tree.streams.flatMap((s) => s.teams.map((t) => t.id));
    expect(new Set(teamIds).size).toBe(teamIds.length);
    expect(teamIds).toHaveLength(8);
  });

  it('returns 404 with the error envelope for an unknown programme', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/missing/hierarchy' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', fieldErrors: [] },
    });
  });
});

describe('GET /api/v1/programmes/:programmeId/sprints', () => {
  it('returns all sprints chronologically without a filter', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/vsdd/sprints' });
    expect(response.statusCode).toBe(200);
    expect((response.json() as Sprint[]).map((s) => s.id)).toEqual(['S13', 'S14', 'S15']);
  });

  it('identifies the current sprint via ?status=current (R2)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/sprints?status=current',
    });
    expect(response.statusCode).toBe(200);
    const sprints = response.json() as Sprint[];
    expect(sprints).toHaveLength(1);
    expect(sprints[0]?.id).toBe('S14');
    expect(sprints[0]?.status).toBe('CURRENT');
  });

  it('returns an empty array when no sprint matches the status', async () => {
    // A second programme with a stream but no sprints exercises the empty case.
    await repository.seedReferenceData({
      programmes: [{ id: 'empty-prog', name: 'Empty', active: true }],
      streams: [],
      teams: [],
      sprints: [],
      checkpoints: [],
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/empty-prog/sprints?status=planned',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns 404 for sprints of an unknown programme', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/programmes/missing/sprints' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 400 VALIDATION_FAILED for an unknown status value', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/sprints?status=bogus',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('reference reads through the vendor-neutral repository', () => {
  it('returns null for an unknown programme and empty lists for empty programmes', async () => {
    await expect(repository.getProgramme('nope')).resolves.toBeNull();
    await expect(repository.listStreams('empty-prog')).resolves.toEqual([]);
    await expect(repository.listTeams('empty-prog')).resolves.toEqual([]);
  });

  it('lists the two weekly checkpoints for a sprint in week order (R2.1)', async () => {
    const checkpoints = await repository.listCheckpoints('S14');
    expect(checkpoints.map((c) => c.weekNumber)).toEqual([1, 2]);
    // Exactly one checkpoint is identified as current (R2.2).
    const current = checkpoints.filter((c) => c.status === 'CURRENT');
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe('C14-1');
  });
});
