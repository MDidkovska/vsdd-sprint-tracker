/**
 * Frontend version-history / comparison client (Phase 9, task 9.4).
 *
 * A small, replaceable seam mirroring the Phase 7 version endpoints — the exact
 * counterpart of the auth and notification clients. The UI depends only on the
 * {@link VersionClient} contract:
 *  - {@link createHttpVersionClient} talks to the REAL backend with the session
 *    cookie (`credentials: 'include'`) and the shared API base URL. This is the
 *    DEFAULT runtime path.
 *  - {@link createMockVersionClient} delegates to the in-memory mock repository
 *    (and computes the diff with the mirrored pure `compareVersions`), used ONLY
 *    when `VITE_AUTH_MODE=mock` (demo/tests).
 *
 * There is NO silent fallback to mock data: when the backend is unreachable the
 * HTTP client throws a connection error the UI surfaces explicitly.
 *
 * This feature is READ-ONLY — the client exposes only GET operations.
 */
import { resolveApiBaseUrl } from '../../auth/authClient';
import type { Repository } from '../../api/repository';
import type { UpdateVersion } from '../../domain/update';
import { compareVersions, type VersionComparison } from '../../domain/versionComparison';

/** Stable version-client error codes surfaced to the UI. */
export type VersionErrorCode =
  | 'CONNECTION_ERROR'
  | 'SESSION_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'LOAD_FAILED';

export class VersionError extends Error {
  readonly code: VersionErrorCode;
  constructor(code: VersionErrorCode, message: string) {
    super(message);
    this.name = 'VersionError';
    this.code = code;
  }
}

export interface VersionClient {
  /** Immutable submitted versions for a team + checkpoint, newest first. */
  getVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;
  /** A single immutable submitted version by id. */
  getVersion(versionId: string): Promise<UpdateVersion>;
  /** Field-by-field comparison of two immutable versions. */
  compareVersions(versionId: string, compareVersionId: string): Promise<VersionComparison>;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

function mapErrorCode(code: string | undefined, status: number): VersionErrorCode {
  if (code === 'SESSION_EXPIRED' || code === 'UNAUTHENTICATED' || status === 401) {
    return 'SESSION_EXPIRED';
  }
  if (code === 'PERMISSION_DENIED' || status === 403) return 'PERMISSION_DENIED';
  if (code === 'NOT_FOUND' || status === 404) return 'NOT_FOUND';
  if (code === 'VALIDATION_FAILED' || status === 400) return 'VALIDATION_FAILED';
  return 'LOAD_FAILED';
}

/** The real HTTP client — the DEFAULT runtime version-history source. */
export function createHttpVersionClient(baseUrl = resolveApiBaseUrl()): VersionClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
    } catch {
      // Network / DNS / CORS failure: surface an explicit connection error —
      // never silently fall back to mock data.
      throw new VersionError(
        'CONNECTION_ERROR',
        'Could not reach the server to load version history.',
      );
    }
    if (!res.ok) {
      let code: string | undefined;
      let message = 'Version history is unavailable. Please try again.';
      try {
        const body = (await res.json()) as ErrorEnvelope;
        code = body.error?.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON error; keep the defaults.
      }
      throw new VersionError(mapErrorCode(code, res.status), message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getVersions: (teamId, checkpointId) =>
      request<UpdateVersion[]>(
        `/teams/${encodeURIComponent(teamId)}/updates/${encodeURIComponent(checkpointId)}/versions`,
        { method: 'GET' },
      ),
    getVersion: (versionId) =>
      request<UpdateVersion>(`/updates/${encodeURIComponent(versionId)}`, { method: 'GET' }),
    compareVersions: (versionId, compareVersionId) =>
      request<VersionComparison>(
        `/updates/${encodeURIComponent(versionId)}/compare/${encodeURIComponent(compareVersionId)}`,
        { method: 'GET' },
      ),
  };
}

/**
 * The mock client (VITE_AUTH_MODE=mock only). Delegates reads to the in-memory
 * mock repository and computes the diff with the mirrored pure
 * {@link compareVersions}, so demo/tests behave like the backend without a
 * server. It reproduces the backend's validation guards (same team + checkpoint;
 * never a version against itself) so the UI's error handling is exercised too.
 */
export function createMockVersionClient(repository: Repository): VersionClient {
  return {
    async getVersions(teamId, checkpointId) {
      // The mock repository keys versions by team + checkpoint; sprintId is not
      // used to filter, so a placeholder is safe here.
      return repository.getVersions({ teamId, sprintId: '', checkpointId });
    },
    getVersion: (versionId) => repository.getVersion(versionId),
    async compareVersions(versionId, compareVersionId) {
      if (versionId === compareVersionId) {
        throw new VersionError('VALIDATION_FAILED', 'Choose two different versions to compare.');
      }
      let base: UpdateVersion;
      let other: UpdateVersion;
      try {
        [base, other] = await Promise.all([
          repository.getVersion(versionId),
          repository.getVersion(compareVersionId),
        ]);
      } catch {
        throw new VersionError('NOT_FOUND', 'One of the versions no longer exists.');
      }
      if (
        base.teamId !== other.teamId ||
        base.sprintId !== other.sprintId ||
        base.checkpointId !== other.checkpointId
      ) {
        throw new VersionError(
          'VALIDATION_FAILED',
          'Versions can only be compared within the same team, sprint and checkpoint.',
        );
      }
      return compareVersions(base, other);
    },
  };
}
