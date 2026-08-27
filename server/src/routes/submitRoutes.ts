/**
 * Atomic submit route (task 7.5).
 *
 * Registers the §6 submit endpoint under the `/api/v1` base path:
 *   POST /api/v1/teams/{teamId}/drafts/{checkpointId}/submit
 *
 * The body is the same DraftUpdateRequest carried by the draft PUT (OpenAPI
 * reuses the schema for both), so the route reuses {@link DRAFT_BODY_SCHEMA}:
 * a malformed body is a 400 VALIDATION_FAILED envelope from Fastify's schema
 * validation before the service runs. The route depends only on the
 * {@link SubmitApi} contract, so it can be tested with a fake API and wired to
 * the real service in production.
 *
 * On success it returns `{ document, version }` (OpenAPI SubmitResult) and sets
 * the new revision as the `ETag`. Submission-level validation failures become a
 * 400 with per-field errors, a stale revision a 409 DRAFT_REVISION_CONFLICT and
 * an already-submitted update a 409 ALREADY_SUBMITTED — all via the shared error
 * handler in `server.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { DraftUpdateRequest } from '../services/draftService.js';
import type { SubmitApi } from '../services/submitService.js';
import { API_BASE_PATH, DRAFT_BODY_SCHEMA } from './draftRoutes.js';

interface SubmitParams {
  teamId: string;
  checkpointId: string;
}

/** Register the atomic submit route against a {@link SubmitApi}. */
export function registerSubmitRoutes(app: FastifyInstance, api: SubmitApi): void {
  app.post<{ Params: SubmitParams; Body: DraftUpdateRequest }>(
    `${API_BASE_PATH}/teams/:teamId/drafts/:checkpointId/submit`,
    { schema: { body: DRAFT_BODY_SCHEMA } },
    async (request, reply) => {
      const result = await api.submit(
        request.params.teamId,
        request.params.checkpointId,
        request.body,
      );
      reply.header('ETag', `"${result.document.revision}"`);
      return result;
    },
  );
}
