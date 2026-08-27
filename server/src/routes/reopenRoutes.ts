/**
 * Authorised reopen route (task 7.6).
 *
 * Registers the §6 reopen endpoint under the `/api/v1` base path:
 *   POST /api/v1/updates/{versionId}/reopen
 *
 * The body is the OpenAPI `ReopenRequest` — a single mandatory `reason`. The
 * route enforces `reason` presence + non-empty via Fastify schema validation
 * (a missing/empty body is a 400 VALIDATION_FAILED envelope before the service
 * runs); a whitespace-only reason is caught by the service. The route depends
 * only on the {@link ReopenApi} contract, so it can be tested with a fake API
 * and wired to the real service in production.
 *
 * On success it returns the new editable REOPENED {@link UpdateDocument} and
 * sets the new revision as the `ETag`. A missing/whitespace reason becomes a
 * 400, an unknown version a 404 NOT_FOUND, an unauthorised caller a 403
 * PERMISSION_DENIED and a concurrent-edit conflict a 409
 * DRAFT_REVISION_CONFLICT — all via the shared error handler in `server.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { ReopenApi, ReopenRequest } from '../services/reopenService.js';
import { API_BASE_PATH } from './draftRoutes.js';

interface ReopenParams {
  versionId: string;
}

/** JSON body schema for the reopen POST (mirrors OpenAPI ReopenRequest). */
export const REOPEN_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reason'],
  properties: {
    reason: { type: 'string', minLength: 1, maxLength: 4000 },
  },
} as const;

/** Register the authorised reopen route against a {@link ReopenApi}. */
export function registerReopenRoutes(app: FastifyInstance, api: ReopenApi): void {
  app.post<{ Params: ReopenParams; Body: ReopenRequest }>(
    `${API_BASE_PATH}/updates/:versionId/reopen`,
    { schema: { body: REOPEN_BODY_SCHEMA } },
    async (request, reply) => {
      const document = await api.reopen(request.params.versionId, request.body);
      reply.header('ETag', `"${document.revision}"`);
      return document;
    },
  );
}
