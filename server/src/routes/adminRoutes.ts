/**
 * Admin approval / assignment routes (Phase 8, design.md §6):
 *   GET  /api/v1/admin/users?status=PENDING
 *   POST /api/v1/admin/users/{userId}/approve
 *   POST /api/v1/admin/users/{userId}/reject
 *   PUT  /api/v1/admin/users/{userId}/assignments
 *   POST /api/v1/admin/users/{userId}/suspend
 *
 * Depends only on the {@link AdminApi} contract. Admin-only authorisation and
 * the "never act on your own account" rule are enforced inside the service (and
 * the request hook additionally gates `/admin/**` to Admins). Responses use the
 * PublicUser projection so a password hash can never leak.
 */
import type { FastifyInstance } from 'fastify';
import type { AccountStatus, AssignmentInput } from '../domain/accounts.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { AdminApi } from '../services/adminService.js';

export const API_BASE_PATH = '/api/v1';

const STATUS_VALUES: AccountStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];

interface UserParams {
  userId: string;
}

interface UsersQuery {
  status?: string;
}

const ASSIGNMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['roles'],
  properties: {
    programmeId: { type: ['string', 'null'] },
    teamIds: { type: 'array', items: { type: 'string' } },
    roles: {
      type: 'array',
      items: { type: 'string', enum: ['CONTRIBUTOR', 'TEAM_LEAD', 'LEADERSHIP', 'ADMIN', 'AUDITOR'] },
    },
  },
} as const;

/** Parse + validate the optional `status` filter for the user list. */
function parseStatus(raw: string | undefined): AccountStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  const upper = raw.toUpperCase() as AccountStatus;
  if (!STATUS_VALUES.includes(upper)) {
    throw ApiError.validation('Unknown status filter.', [
      { path: 'status', message: 'Must be PENDING, ACTIVE, REJECTED or SUSPENDED.' },
    ]);
  }
  return upper;
}

/** Normalise an assignment body (teamIds/programmeId default when omitted). */
function toAssignmentInput(body: Partial<AssignmentInput>): AssignmentInput {
  return {
    programmeId: body.programmeId ?? null,
    teamIds: body.teamIds ?? [],
    roles: body.roles ?? [],
  };
}

export function registerAdminRoutes(app: FastifyInstance, api: AdminApi): void {
  app.get<{ Querystring: UsersQuery }>(
    `${API_BASE_PATH}/admin/users`,
    async (request) => {
      const status = parseStatus(request.query.status);
      return api.listUsers(status);
    },
  );

  app.post<{ Params: UserParams; Body: Partial<AssignmentInput> }>(
    `${API_BASE_PATH}/admin/users/:userId/approve`,
    { schema: { body: ASSIGNMENT_SCHEMA } },
    async (request) => {
      return api.approve(request.params.userId, toAssignmentInput(request.body));
    },
  );

  app.post<{ Params: UserParams }>(
    `${API_BASE_PATH}/admin/users/:userId/reject`,
    async (request) => {
      return api.reject(request.params.userId);
    },
  );

  app.put<{ Params: UserParams; Body: Partial<AssignmentInput> }>(
    `${API_BASE_PATH}/admin/users/:userId/assignments`,
    { schema: { body: ASSIGNMENT_SCHEMA } },
    async (request) => {
      return api.updateAssignments(request.params.userId, toAssignmentInput(request.body));
    },
  );

  app.post<{ Params: UserParams }>(
    `${API_BASE_PATH}/admin/users/:userId/suspend`,
    async (request) => {
      return api.suspend(request.params.userId);
    },
  );
}
