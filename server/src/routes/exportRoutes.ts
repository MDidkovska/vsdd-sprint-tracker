/**
 * Structured leadership export route (task 7.10).
 *
 * Registers the §6 export endpoint under the `/api/v1` base path:
 *   POST /api/v1/programmes/{programmeId}/exports  — create an export (200)
 *
 * The body is the OpenAPI `ExportRequest` — a required reporting cycle
 * (`sprintId`, `checkpointId`) plus the required `filters` envelope
 * (`streamId`, `rag`, `state`). The route enforces the body shape via Fastify
 * schema validation (a malformed body is a 400 VALIDATION_FAILED envelope
 * before the service runs); the service validates the cycle values, authorises
 * the caller and produces the snapshot. The route depends only on the
 * {@link ExportApi} contract, so it can be tested with a fake API and wired to
 * the real service in production.
 *
 * A successful export returns 200 with the snapshot. An unauthorised caller
 * becomes a 403 PERMISSION_DENIED, an unknown programme/cycle a 404 NOT_FOUND
 * and a missing/invalid cycle a 400 VALIDATION_FAILED — all via the shared
 * error handler in `server.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { ExportRequest } from '../domain/exportSnapshot.js';
import type { ExportApi } from '../services/exportService.js';
import { API_BASE_PATH } from './hierarchyRoutes.js';

interface ProgrammeParams {
  programmeId: string;
}

/** JSON body schema for the export POST (mirrors OpenAPI ExportRequest). */
export const EXPORT_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sprintId', 'checkpointId', 'filters'],
  properties: {
    sprintId: { type: 'string', minLength: 1 },
    checkpointId: { type: 'string', minLength: 1 },
    filters: {
      type: 'object',
      additionalProperties: false,
      required: ['streamId', 'rag', 'state'],
      properties: {
        streamId: { type: 'string', minLength: 1 },
        rag: { type: 'string', enum: ['ALL', 'GREEN', 'AMBER', 'RED'] },
        state: {
          type: 'string',
          enum: ['ALL', 'MISSING', 'DRAFT', 'SUBMITTED', 'REOPENED', 'STALE'],
        },
      },
    },
  },
} as const;

/** Register the structured export route against an {@link ExportApi}. */
export function registerExportRoutes(app: FastifyInstance, api: ExportApi): void {
  app.post<{ Params: ProgrammeParams; Body: ExportRequest }>(
    `${API_BASE_PATH}/programmes/:programmeId/exports`,
    { schema: { body: EXPORT_BODY_SCHEMA } },
    async (request) => {
      // The client IP is passed only as a rate-limit key (task 10.3); it never
      // affects the exported data.
      return api.createExport(request.params.programmeId, request.body, request.ip);
    },
  );
}
