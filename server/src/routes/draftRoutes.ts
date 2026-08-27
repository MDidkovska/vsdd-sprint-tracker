/**
 * Team-draft read/write routes (task 7.4).
 *
 * Registers the §6 draft endpoints under the `/api/v1` base path:
 *   GET /api/v1/teams/{teamId}/updates/{checkpointId}   — read the current draft
 *   PUT /api/v1/teams/{teamId}/drafts/{checkpointId}     — save with a revision
 *
 * The routes depend only on the {@link DraftApi} contract, so the server can be
 * tested with a fake API (no MongoDB) and wired to the real service in
 * production. The response carries the current/new `revision` as an `ETag`
 * optimistic-concurrency token. A malformed body is rejected as a 400
 * VALIDATION_FAILED envelope by Fastify's schema validation; a stale revision
 * becomes a 409 DRAFT_REVISION_CONFLICT (error + server metadata) via the
 * shared error handler in `server.ts`.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { UpdateDocument } from '../domain/documents.js';
import type { DraftApi, DraftUpdateRequest } from '../services/draftService.js';

export const API_BASE_PATH = '/api/v1';

interface DraftParams {
  teamId: string;
  checkpointId: string;
}

/** JSON body schema for the draft PUT (mirrors OpenAPI DraftUpdateRequest). */
const RAG_VALUE = { type: 'string', enum: ['GREEN', 'AMBER', 'RED'] } as const;

export const DRAFT_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'revision',
    'rag',
    'goals',
    'qualityEvidence',
    'achievements',
    'aiValue',
    'exceptions',
    'leadershipAsk',
  ],
  properties: {
    revision: { type: 'integer', minimum: 0 },
    rag: {
      type: 'object',
      additionalProperties: false,
      required: ['business', 'delivery', 'release'],
      properties: { business: RAG_VALUE, delivery: RAG_VALUE, release: RAG_VALUE },
    },
    goals: {
      type: 'object',
      additionalProperties: false,
      required: ['business', 'technicalTesting', 'sprintCommitment', 'nextWeekCommitment'],
      properties: {
        business: { type: 'string' },
        technicalTesting: { type: 'string' },
        sprintCommitment: { type: 'string' },
        nextWeekCommitment: { type: 'string' },
      },
    },
    qualityEvidence: {
      type: 'object',
      additionalProperties: false,
      required: ['planned', 'executed', 'passed', 'openCritical', 'blocked', 'automationPercent'],
      properties: {
        planned: { type: 'number' },
        executed: { type: 'number' },
        passed: { type: 'number' },
        openCritical: { type: 'number' },
        blocked: { type: 'number' },
        automationPercent: { type: 'number' },
      },
    },
    achievements: { type: 'string', maxLength: 4000 },
    aiValue: {
      type: 'object',
      additionalProperties: false,
      required: ['useCase', 'measurableBenefit', 'humanValidation', 'nextExperimentConstraint'],
      properties: {
        useCase: { type: 'string' },
        measurableBenefit: { type: 'string' },
        humanValidation: { type: 'string' },
        nextExperimentConstraint: { type: 'string' },
      },
    },
    exceptions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'impact', 'owner', 'dueDate', 'decisionSupport', 'status'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['RISK', 'ISSUE', 'BLOCKER'] },
          impact: { type: 'string' },
          owner: { type: 'string' },
          dueDate: { type: 'string' },
          decisionSupport: { type: 'string' },
          status: { type: 'string', enum: ['OPEN', 'RESOLVED'] },
          resolvedAt: { type: 'string' },
          resolutionNote: { type: 'string' },
        },
      },
    },
    leadershipAsk: { type: 'string', maxLength: 4000 },
    statusRationale: { type: 'string', maxLength: 4000 },
    metricsNote: { type: 'string', maxLength: 4000 },
  },
} as const;

/** Set the ETag header to the document's revision (optimistic-concurrency token). */
function setRevisionEtag(reply: FastifyReply, document: UpdateDocument): void {
  reply.header('ETag', `"${document.revision}"`);
}

/** Register the team-draft read/write routes against a {@link DraftApi}. */
export function registerDraftRoutes(app: FastifyInstance, api: DraftApi): void {
  app.get<{ Params: DraftParams }>(
    `${API_BASE_PATH}/teams/:teamId/updates/:checkpointId`,
    async (request, reply) => {
      const document = await api.getUpdate(
        request.params.teamId,
        request.params.checkpointId,
      );
      setRevisionEtag(reply, document);
      return document;
    },
  );

  app.put<{ Params: DraftParams; Body: DraftUpdateRequest }>(
    `${API_BASE_PATH}/teams/:teamId/drafts/:checkpointId`,
    { schema: { body: DRAFT_BODY_SCHEMA } },
    async (request, reply) => {
      const document = await api.saveDraft(
        request.params.teamId,
        request.params.checkpointId,
        request.body,
      );
      setRevisionEtag(reply, document);
      return document;
    },
  );
}
