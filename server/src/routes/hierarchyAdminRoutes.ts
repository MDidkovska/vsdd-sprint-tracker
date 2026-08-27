/**
 * Programme hierarchy / reporting-cycle administration routes (Phase 9, task 9.5):
 *   POST /api/v1/admin/streams
 *   PUT  /api/v1/admin/streams/{streamId}
 *   POST /api/v1/admin/teams
 *   PUT  /api/v1/admin/teams/{teamId}
 *   POST /api/v1/admin/teams/{teamId}/archive
 *   POST /api/v1/admin/sprints
 *   POST /api/v1/admin/checkpoints/{checkpointId}/set-current
 *   POST /api/v1/admin/checkpoints/{checkpointId}/close
 *   POST /api/v1/admin/checkpoints/{checkpointId}/reopen
 *
 * Depends only on the {@link HierarchyAdminApi} contract. Admin-only
 * authorisation is enforced inside the service (assertAdmin) AND the request
 * hook additionally gates `/admin/**` to Admins (design.md §5a). All referential
 * validation (programme/stream existence, unique team name within a stream,
 * exactly two weekly checkpoints, single current checkpoint, reopen reason)
 * lives in the service; these routes only shape the request/response.
 */
import type { FastifyInstance } from 'fastify';
import type {
  CreateSprintInput,
  CreateStreamInput,
  CreateTeamInput,
  HierarchyAdminApi,
  UpdateStreamInput,
  UpdateTeamInput,
} from '../services/hierarchyAdminService.js';

export const API_BASE_PATH = '/api/v1';

interface StreamParams {
  streamId: string;
}

interface TeamParams {
  teamId: string;
}

interface CheckpointParams {
  checkpointId: string;
}

const CREATE_STREAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'programmeId', 'name'],
  properties: {
    id: { type: 'string', minLength: 1 },
    programmeId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
  },
} as const;

const UPDATE_STREAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
    active: { type: 'boolean' },
  },
} as const;

const CREATE_TEAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'programmeId', 'streamId', 'name'],
  properties: {
    id: { type: 'string', minLength: 1 },
    programmeId: { type: 'string', minLength: 1 },
    streamId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
  },
} as const;

const UPDATE_TEAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    sortOrder: { type: 'number' },
    active: { type: 'boolean' },
  },
} as const;

const CREATE_SPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'programmeId', 'label', 'startDate', 'endDate'],
  properties: {
    id: { type: 'string', minLength: 1 },
    programmeId: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
    startDate: { type: 'string', minLength: 1 },
    endDate: { type: 'string', minLength: 1 },
  },
} as const;

const REOPEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: { type: 'string', minLength: 1 },
  },
} as const;

export function registerHierarchyAdminRoutes(
  app: FastifyInstance,
  api: HierarchyAdminApi,
): void {
  app.post<{ Body: CreateStreamInput }>(
    `${API_BASE_PATH}/admin/streams`,
    { schema: { body: CREATE_STREAM_SCHEMA } },
    async (request, reply) => {
      const stream = await api.createStream(request.body);
      reply.code(201);
      return stream;
    },
  );

  app.put<{ Params: StreamParams; Body: Omit<UpdateStreamInput, 'id'> }>(
    `${API_BASE_PATH}/admin/streams/:streamId`,
    { schema: { body: UPDATE_STREAM_SCHEMA } },
    async (request) => {
      return api.updateStream({ ...request.body, id: request.params.streamId });
    },
  );

  app.post<{ Body: CreateTeamInput }>(
    `${API_BASE_PATH}/admin/teams`,
    { schema: { body: CREATE_TEAM_SCHEMA } },
    async (request, reply) => {
      const team = await api.createTeam(request.body);
      reply.code(201);
      return team;
    },
  );

  app.put<{ Params: TeamParams; Body: Omit<UpdateTeamInput, 'id'> }>(
    `${API_BASE_PATH}/admin/teams/:teamId`,
    { schema: { body: UPDATE_TEAM_SCHEMA } },
    async (request) => {
      return api.updateTeam({ ...request.body, id: request.params.teamId });
    },
  );

  // Archive a team (task 9.6, R17.2/R17.4): non-destructive — marks the team
  // inactive and stamps `archivedAt` without removing any historical record.
  app.post<{ Params: TeamParams }>(
    `${API_BASE_PATH}/admin/teams/:teamId/archive`,
    async (request) => {
      return api.archiveTeam(request.params.teamId);
    },
  );

  app.post<{ Body: CreateSprintInput }>(
    `${API_BASE_PATH}/admin/sprints`,
    { schema: { body: CREATE_SPRINT_SCHEMA } },
    async (request, reply) => {
      const result = await api.createSprint(request.body);
      reply.code(201);
      return result;
    },
  );

  app.post<{ Params: CheckpointParams }>(
    `${API_BASE_PATH}/admin/checkpoints/:checkpointId/set-current`,
    async (request) => {
      return api.setCurrentCheckpoint(request.params.checkpointId);
    },
  );

  app.post<{ Params: CheckpointParams }>(
    `${API_BASE_PATH}/admin/checkpoints/:checkpointId/close`,
    async (request) => {
      return api.closeCheckpoint(request.params.checkpointId);
    },
  );

  app.post<{ Params: CheckpointParams; Body: { reason: string } }>(
    `${API_BASE_PATH}/admin/checkpoints/:checkpointId/reopen`,
    { schema: { body: REOPEN_SCHEMA } },
    async (request) => {
      return api.reopenCheckpoint(request.params.checkpointId, request.body.reason);
    },
  );
}
