/**
 * Admin config client tests (Phase 9, task 9.5).
 *
 * Cover the in-memory mock client invariants (unique team name within a stream,
 * exactly two weekly checkpoints, single CURRENT checkpoint, closed-window
 * refusal, reopen-requires-reason) and the HTTP client's explicit error
 * surfaces: a network failure maps to CONNECTION_ERROR (never a silent mock
 * fallback) and a backend error envelope maps to the right stable code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdminConfigError,
  createHttpAdminConfigClient,
  createMockAdminConfigClient,
} from './adminConfigClient';

describe('createMockAdminConfigClient', () => {
  it('creates a stream and a team within it', async () => {
    const client = createMockAdminConfigClient();
    const stream = await client.createStream({ id: 'GRMB', programmeId: 'vsdd', name: 'GRMB' });
    expect(stream.active).toBe(true);
    const team = await client.createTeam({
      id: 'grmb-a',
      programmeId: 'vsdd',
      streamId: 'GRMB',
      name: 'GRMB A',
    });
    expect(team.streamId).toBe('GRMB');
  });

  it('rejects a duplicate active team name within a stream', async () => {
    const client = createMockAdminConfigClient();
    await client.createTeam({ id: 'a', programmeId: 'vsdd', streamId: 'MMM', name: 'Team A' });
    await expect(
      client.createTeam({ id: 'b', programmeId: 'vsdd', streamId: 'MMM', name: 'team a' }),
    ).rejects.toBeInstanceOf(AdminConfigError);
  });

  it('creates a sprint with exactly two weekly checkpoints', async () => {
    const client = createMockAdminConfigClient();
    const { checkpoints } = await client.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.map((c) => c.weekNumber).sort()).toEqual([1, 2]);
  });

  it('keeps a single CURRENT checkpoint and refuses a closed window', async () => {
    const client = createMockAdminConfigClient();
    await client.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    await client.setCurrentCheckpoint('S16-W1');
    const w2 = await client.setCurrentCheckpoint('S16-W2');
    expect(w2.status).toBe('CURRENT');
    await client.closeCheckpoint('S16-W1');
    await expect(client.setCurrentCheckpoint('S16-W1')).rejects.toMatchObject({
      code: 'WINDOW_CLOSED',
    });
  });

  it('makes a newly created team immediately available for assignment (mock)', async () => {
    const client = createMockAdminConfigClient();
    const before = await client.listActiveTeams();
    expect(before.some((t) => t.id === 'new-team')).toBe(false);
    await client.createTeam({ id: 'new-team', programmeId: 'vsdd', streamId: 'MMM', name: 'New Team' });
    const after = await client.listActiveTeams();
    expect(after.some((t) => t.id === 'new-team' && t.active)).toBe(true);
  });

  it('requires a reason to reopen a closed window', async () => {
    const client = createMockAdminConfigClient();
    await client.createSprint({
      id: 'S16',
      programmeId: 'vsdd',
      label: 'Sprint 16',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-19T00:00:00.000Z',
    });
    await client.closeCheckpoint('S16-W1');
    await expect(client.reopenCheckpoint('S16-W1', '  ')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const reopened = await client.reopenCheckpoint('S16-W1', 'Late submission agreed');
    expect(reopened.status).toBe('CURRENT');
  });
});

describe('createHttpAdminConfigClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces a network failure as CONNECTION_ERROR (no silent fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const client = createHttpAdminConfigClient('http://api.test');
    await expect(
      client.createStream({ id: 'X', programmeId: 'vsdd', name: 'X' }),
    ).rejects.toMatchObject({ code: 'CONNECTION_ERROR' });
  });

  it('listActiveTeams reads the hierarchy API and returns only active teams', async () => {
    const tree = {
      programme: { id: 'vsdd', name: 'VSDD', active: true },
      streams: [
        {
          stream: { id: 'MMM', programmeId: 'vsdd', name: 'MMM', sortOrder: 1, active: true },
          teams: [
            { id: 'mmm-a', streamId: 'MMM', name: 'MMM A', sortOrder: 1, active: true },
            { id: 'mmm-x', streamId: 'MMM', name: 'MMM X', sortOrder: 2, active: false },
          ],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => tree,
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpAdminConfigClient('http://api.test');
    const teams = await client.listActiveTeams('vsdd');
    expect(teams.map((t) => t.id)).toEqual(['mmm-a']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/programmes/vsdd/hierarchy');
    expect(init.credentials).toBe('include');
  });

  it('maps a 403 error envelope to PERMISSION_DENIED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 'PERMISSION_DENIED', message: 'no' } }),
      }),
    );
    const client = createHttpAdminConfigClient('http://api.test');
    await expect(
      client.createStream({ id: 'X', programmeId: 'vsdd', name: 'X' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
