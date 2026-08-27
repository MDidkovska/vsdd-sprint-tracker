/**
 * Frontend hierarchy / reporting-cycle admin client (Phase 9, task 9.5).
 *
 * A small, replaceable seam mirroring the backend Programme-Admin configuration
 * API, and the exact counterpart of the notification/version clients. The UI
 * depends only on the {@link AdminConfigClient} contract:
 *  - {@link createHttpAdminConfigClient} talks to the REAL backend with the
 *    session cookie (`credentials: 'include'`) and the shared API base URL. This
 *    is the DEFAULT runtime path.
 *  - {@link createMockAdminConfigClient} is an in-memory implementation used
 *    ONLY when `VITE_AUTH_MODE=mock` (demo/tests).
 *
 * There is NO silent fallback to mock data: when the backend is unreachable the
 * HTTP client throws a CONNECTION_ERROR the UI surfaces explicitly.
 */
import { resolveApiBaseUrl } from '../../auth/authClient';
import { PROGRAMME_ID } from '../../config';
import type {
  HierarchyTree,
  ReportingCheckpoint,
  Sprint,
  Stream,
  Team,
} from '../../domain/hierarchy';
import { TEAMS } from '../../api/seed';

export type AdminConfigErrorCode =
  | 'CONNECTION_ERROR'
  | 'SESSION_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'WINDOW_CLOSED'
  | 'SAVE_FAILED';

export class AdminConfigError extends Error {
  readonly code: AdminConfigErrorCode;
  constructor(code: AdminConfigErrorCode, message: string) {
    super(message);
    this.name = 'AdminConfigError';
    this.code = code;
  }
}

export interface CreateStreamInput {
  id: string;
  programmeId: string;
  name: string;
  sortOrder?: number;
}
export interface UpdateStreamInput {
  name?: string;
  sortOrder?: number;
  active?: boolean;
}
export interface CreateTeamInput {
  id: string;
  programmeId: string;
  streamId: string;
  name: string;
  sortOrder?: number;
}
export interface UpdateTeamInput {
  name?: string;
  sortOrder?: number;
  active?: boolean;
}
export interface CreateSprintInput {
  id: string;
  programmeId: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface AdminConfigClient {
  /**
   * List the programme's ACTIVE teams from the real hierarchy/config API. This
   * is what the assignment editor uses so it never depends on the static
   * frontend seed outside mock mode, and a newly created team is immediately
   * assignable.
   */
  listActiveTeams(programmeId?: string): Promise<Team[]>;
  createStream(input: CreateStreamInput): Promise<Stream>;
  updateStream(streamId: string, input: UpdateStreamInput): Promise<Stream>;
  createTeam(input: CreateTeamInput): Promise<Team>;
  updateTeam(teamId: string, input: UpdateTeamInput): Promise<Team>;
  createSprint(
    input: CreateSprintInput,
  ): Promise<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }>;
  setCurrentCheckpoint(checkpointId: string): Promise<ReportingCheckpoint>;
  closeCheckpoint(checkpointId: string): Promise<ReportingCheckpoint>;
  reopenCheckpoint(checkpointId: string, reason: string): Promise<ReportingCheckpoint>;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

function mapErrorCode(code: string | undefined, status: number): AdminConfigErrorCode {
  switch (code) {
    case 'SESSION_EXPIRED':
    case 'UNAUTHENTICATED':
      return 'SESSION_EXPIRED';
    case 'PERMISSION_DENIED':
      return 'PERMISSION_DENIED';
    case 'VALIDATION_FAILED':
      return 'VALIDATION_FAILED';
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'INVALID_STATE':
      return 'INVALID_STATE';
    case 'WINDOW_CLOSED':
      return 'WINDOW_CLOSED';
    default:
      break;
  }
  if (status === 401) return 'SESSION_EXPIRED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 404) return 'NOT_FOUND';
  return 'SAVE_FAILED';
}

/** The real HTTP client — the DEFAULT runtime configuration source. */
export function createHttpAdminConfigClient(
  baseUrl = resolveApiBaseUrl(),
): AdminConfigClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
    } catch {
      throw new AdminConfigError(
        'CONNECTION_ERROR',
        'Could not reach the server to apply the configuration change.',
      );
    }
    if (!res.ok) {
      let code: string | undefined;
      let message = 'The configuration change could not be applied. Please try again.';
      try {
        const body = (await res.json()) as ErrorEnvelope;
        code = body.error?.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON error; keep the defaults.
      }
      throw new AdminConfigError(mapErrorCode(code, res.status), message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    listActiveTeams: async (programmeId = PROGRAMME_ID) => {
      const tree = await request<HierarchyTree>(
        `/programmes/${encodeURIComponent(programmeId)}/hierarchy`,
        { method: 'GET' },
      );
      return tree.streams.flatMap((group) => group.teams).filter((t) => t.active);
    },
    createStream: (input) =>
      request<Stream>('/admin/streams', { method: 'POST', body: JSON.stringify(input) }),
    updateStream: (streamId, input) =>
      request<Stream>(`/admin/streams/${encodeURIComponent(streamId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    createTeam: (input) =>
      request<Team>('/admin/teams', { method: 'POST', body: JSON.stringify(input) }),
    updateTeam: (teamId, input) =>
      request<Team>(`/admin/teams/${encodeURIComponent(teamId)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    createSprint: (input) =>
      request<{ sprint: Sprint; checkpoints: ReportingCheckpoint[] }>('/admin/sprints', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    setCurrentCheckpoint: (id) =>
      request<ReportingCheckpoint>(
        `/admin/checkpoints/${encodeURIComponent(id)}/set-current`,
        { method: 'POST' },
      ),
    closeCheckpoint: (id) =>
      request<ReportingCheckpoint>(`/admin/checkpoints/${encodeURIComponent(id)}/close`, {
        method: 'POST',
      }),
    reopenCheckpoint: (id, reason) =>
      request<ReportingCheckpoint>(`/admin/checkpoints/${encodeURIComponent(id)}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
  };
}

/**
 * The mock client (VITE_AUTH_MODE=mock only). A small in-memory implementation
 * mirroring the backend invariants (unique active team name within a stream,
 * exactly two weekly checkpoints, a single CURRENT checkpoint, closed-window
 * refusal, reopen-requires-reason) so the demo/tests behave like the backend
 * without a server.
 */
export function createMockAdminConfigClient(): AdminConfigClient {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const streams = new Map<string, Stream>();
  const teams = new Map<string, Team>();
  const sprints = new Map<string, Sprint>();
  const checkpoints = new Map<string, ReportingCheckpoint>();
  // Seed a single stream so team creation has somewhere to land in the demo.
  streams.set('MMM', { id: 'MMM', programmeId: PROGRAMME_ID, name: 'MMM', sortOrder: 1, active: true });

  function requireCheckpoint(id: string): ReportingCheckpoint {
    const cp = checkpoints.get(id);
    if (!cp) throw new AdminConfigError('NOT_FOUND', `Checkpoint "${id}" was not found.`);
    return cp;
  }

  function makeCurrent(target: ReportingCheckpoint): ReportingCheckpoint {
    for (const cp of checkpoints.values()) {
      if (cp.sprintId === target.sprintId && cp.id !== target.id && cp.status === 'CURRENT') {
        checkpoints.set(cp.id, { ...cp, status: 'CLOSED' });
      }
    }
    const updated: ReportingCheckpoint = { ...target, status: 'CURRENT' };
    checkpoints.set(updated.id, updated);
    return updated;
  }

  return {
    async listActiveTeams() {
      // Mock mode only: the seed teams plus any team created in this session,
      // deduped by id, so a newly created team is immediately assignable.
      const byId = new Map<string, Team>();
      for (const t of TEAMS) if (t.active) byId.set(t.id, t);
      for (const t of teams.values()) if (t.active) byId.set(t.id, t);
      return [...byId.values()];
    },
    async createStream(input) {
      const name = input.name.trim();
      if (!name) throw new AdminConfigError('VALIDATION_FAILED', 'A stream name is required.');
      const stream: Stream = {
        id: input.id,
        programmeId: input.programmeId,
        name,
        sortOrder: input.sortOrder ?? 0,
        active: true,
      };
      streams.set(stream.id, stream);
      return stream;
    },
    async updateStream(streamId, input) {
      const existing = streams.get(streamId);
      if (!existing) throw new AdminConfigError('NOT_FOUND', `Stream "${streamId}" was not found.`);
      const updated: Stream = {
        ...existing,
        name: input.name?.trim() || existing.name,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        active: input.active ?? existing.active,
      };
      streams.set(updated.id, updated);
      return updated;
    },
    async createTeam(input) {
      const stream = streams.get(input.streamId);
      if (!stream || stream.programmeId !== input.programmeId) {
        throw new AdminConfigError('VALIDATION_FAILED', 'Stream is not in this programme.');
      }
      const name = input.name.trim();
      if (!name) throw new AdminConfigError('VALIDATION_FAILED', 'A team name is required.');
      const clash = [...teams.values()].some(
        (t) =>
          t.streamId === input.streamId &&
          t.active &&
          t.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (clash) {
        throw new AdminConfigError(
          'VALIDATION_FAILED',
          `A team named "${name}" already exists in this stream.`,
        );
      }
      const team: Team = {
        id: input.id,
        streamId: input.streamId,
        name,
        sortOrder: input.sortOrder ?? 0,
        active: true,
      };
      teams.set(team.id, team);
      return team;
    },
    async updateTeam(teamId, input) {
      const existing = teams.get(teamId);
      if (!existing) throw new AdminConfigError('NOT_FOUND', `Team "${teamId}" was not found.`);
      const nextName = input.name?.trim() || existing.name;
      const nextActive = input.active ?? existing.active;
      if (nextActive && nextName.toLowerCase() !== existing.name.toLowerCase()) {
        const clash = [...teams.values()].some(
          (t) =>
            t.id !== existing.id &&
            t.streamId === existing.streamId &&
            t.active &&
            t.name.trim().toLowerCase() === nextName.toLowerCase(),
        );
        if (clash) {
          throw new AdminConfigError('VALIDATION_FAILED', 'Team name must be unique within the stream.');
        }
      }
      const updated: Team = {
        ...existing,
        name: nextName,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        active: nextActive,
      };
      teams.set(updated.id, updated);
      return updated;
    },
    async createSprint(input) {
      if (!input.label.trim()) {
        throw new AdminConfigError('VALIDATION_FAILED', 'A sprint label is required.');
      }
      const start = Date.parse(input.startDate);
      const end = Date.parse(input.endDate);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new AdminConfigError('VALIDATION_FAILED', 'Sprint dates must be valid ISO dates.');
      }
      if (end < start) {
        throw new AdminConfigError('VALIDATION_FAILED', 'End date must not precede start date.');
      }
      const sprint: Sprint = {
        id: input.id,
        programmeId: input.programmeId,
        label: input.label.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'PLANNED',
      };
      const midIso = new Date(start + WEEK_MS).toISOString();
      const created: ReportingCheckpoint[] = [
        {
          id: `${sprint.id}-W1`,
          sprintId: sprint.id,
          weekNumber: 1,
          opensAt: input.startDate,
          dueAt: midIso,
          closesAt: midIso,
          status: 'UPCOMING',
        },
        {
          id: `${sprint.id}-W2`,
          sprintId: sprint.id,
          weekNumber: 2,
          opensAt: midIso,
          dueAt: input.endDate,
          closesAt: input.endDate,
          status: 'UPCOMING',
        },
      ];
      sprints.set(sprint.id, sprint);
      for (const cp of created) checkpoints.set(cp.id, cp);
      return { sprint, checkpoints: created };
    },
    async setCurrentCheckpoint(id) {
      const target = requireCheckpoint(id);
      if (target.status === 'CLOSED') {
        throw new AdminConfigError('WINDOW_CLOSED', 'Reopen this window before making it current.');
      }
      return makeCurrent(target);
    },
    async closeCheckpoint(id) {
      const target = requireCheckpoint(id);
      const closed: ReportingCheckpoint = { ...target, status: 'CLOSED' };
      checkpoints.set(closed.id, closed);
      return closed;
    },
    async reopenCheckpoint(id, reason) {
      if (!reason.trim()) {
        throw new AdminConfigError('VALIDATION_FAILED', 'A reason is required to reopen a window.');
      }
      const target = requireCheckpoint(id);
      if (target.status !== 'CLOSED') {
        throw new AdminConfigError('INVALID_STATE', 'Only a closed window can be reopened.');
      }
      return makeCurrent(target);
    },
  };
}
