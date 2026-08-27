/**
 * HTTP version-client tests (task 9.4).
 *
 * Prove the default-runtime client talks to the real Phase 7 endpoints with the
 * session cookie (`credentials: 'include'`) and the shared API base URL, and
 * surfaces explicit typed errors (no silent mock fallback) for connection,
 * session, permission, not-found and validation failures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpVersionClient, VersionError, type VersionClient } from './versionClient';
import type { UpdateVersion } from '../../domain/update';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const version: UpdateVersion = {
  id: 'mmm-a-S14-C14-1-v1',
  teamId: 'mmm-a',
  sprintId: 'S14',
  checkpointId: 'C14-1',
  versionNumber: 1,
  submittedBy: 'lead@vsdd.test',
  submittedAt: '2026-08-25T09:14:00Z',
  schemaVersion: 1,
  rag: { business: 'GREEN', delivery: 'AMBER', release: 'GREEN' },
  hasBlocker: false,
  hasLeadershipAsk: false,
  payload: {
    goals: {
      business: 'b',
      technicalTesting: 't',
      sprintCommitment: 's',
      nextWeekCommitment: 'n',
    },
    qualityEvidence: {
      planned: 10,
      executed: 8,
      passed: 7,
      openCritical: 0,
      blocked: 0,
      automationPercent: 50,
    },
    achievements: 'did things',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: 'None',
  },
};

function withFetch(mock: ReturnType<typeof vi.fn>): VersionClient {
  vi.stubGlobal('fetch', mock);
  return createHttpVersionClient('/api/v1');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpVersionClient', () => {
  it('lists versions for a team + checkpoint with the session cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([version]));
    const client = withFetch(fetchMock);

    const result = await client.getVersions('mmm-a', 'C14-1');

    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/teams/mmm-a/updates/C14-1/versions',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('reads a single version via GET /updates/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(version));
    const client = withFetch(fetchMock);

    const result = await client.getVersion('mmm-a-S14-C14-1-v1');

    expect(result.versionNumber).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/updates/mmm-a-S14-C14-1-v1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('compares two versions via GET /updates/:id/compare/:otherId', async () => {
    const comparison = { previous: {}, current: {}, fields: [], exceptions: [], changedPaths: [], hasChanges: false };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(comparison));
    const client = withFetch(fetchMock);

    await client.compareVersions('v1', 'v2');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/updates/v1/compare/v2',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('surfaces an explicit CONNECTION_ERROR when the backend is unreachable', async () => {
    const client = withFetch(vi.fn().mockRejectedValue(new TypeError('network down')));
    await expect(client.getVersions('mmm-a', 'C14-1')).rejects.toBeInstanceOf(VersionError);
    await expect(client.getVersions('mmm-a', 'C14-1')).rejects.toMatchObject({
      code: 'CONNECTION_ERROR',
    });
  });

  it('maps 401→SESSION_EXPIRED, 403→PERMISSION_DENIED, 404→NOT_FOUND, 400→VALIDATION_FAILED', async () => {
    const unauth = withFetch(
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'SESSION_EXPIRED' } }, 401)),
    );
    await expect(unauth.getVersions('t', 'c')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });

    const forbidden = withFetch(
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'PERMISSION_DENIED' } }, 403)),
    );
    await expect(forbidden.getVersions('t', 'c')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });

    const missing = withFetch(
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404)),
    );
    await expect(missing.getVersion('gone')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const invalid = withFetch(
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'VALIDATION_FAILED' } }, 400)),
    );
    await expect(invalid.compareVersions('v1', 'v1')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});
