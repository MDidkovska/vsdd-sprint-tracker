/**
 * Leadership decision routes (task 7.9).
 *
 * Registers the §6 decision endpoints under the `/api/v1` base path:
 *   POST /api/v1/updates/{versionId}/decisions  — record a decision (201)
 *   GET  /api/v1/updates/{versionId}/decisions  — list decisions   (200)
 *
 * The body is the OpenAPI `DecisionRequest` — a mandatory `decision` plus an
 * optional `dueDate`. The route enforces `decision` presence + non-empty via
 * Fastify schema validation (a missing/empty body is a 400 VALIDATION_FAILED
 * envelope before the service runs); a whitespace-only decision is caught by
 * the service. The routes depend only on the {@link DecisionApi} contract, so
 * they can be tested with a fake API and wired to the real service in
 * production.
 *
 * A recorded decision is returned with a 201 status. A missing/whitespace
 * decision becomes a 400, an unknown version a 404 NOT_FOUND and an
 * unauthorised caller a 403 PERMISSION_DENIED — all via the shared error
 * handler in `server.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { DecisionApi, DecisionRequest } from '../services/decisionService.js';
import { API_BASE_PATH } from './draftRoutes.js';

interface DecisionParams {
  versionId: string;
}

/** JSON body schema for the decision POST (mirrors OpenAPI DecisionRequest). */
export const DECISION_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: { type: 'string', minLength: 1, maxLength: 4000 },
    dueDate: { type: 'string' },
  },
} as const;

/** Register the leadership decision routes against a {@link DecisionApi}. */
export function registerDecisionRoutes(app: FastifyInstance, api: DecisionApi): void {
  app.post<{ Params: DecisionParams; Body: DecisionRequest }>(
    `${API_BASE_PATH}/updates/:versionId/decisions`,
    { schema: { body: DECISION_BODY_SCHEMA } },
    async (request, reply) => {
      const decision = await api.recordDecision(request.params.versionId, request.body);
      reply.code(201);
      return decision;
    },
  );

  app.get<{ Params: DecisionParams }>(
    `${API_BASE_PATH}/updates/:versionId/decisions`,
    async (request) => {
      return api.getDecisions(request.params.versionId);
    },
  );
}
