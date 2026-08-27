/**
 * Leadership summary / filtered hierarchy projection route (task 7.7).
 *
 * Registers the §6 leadership read endpoint under the `/api/v1` base path:
 *   GET /api/v1/programmes/{programmeId}/reporting-summary
 *       ?sprintId=&checkpointId=&streamId=&rag=&state=
 *
 * The route depends only on the {@link SummaryApi} contract, so the server can
 * be tested with a fake API (no MongoDB) and wired to the real service in
 * production. All validation and projection logic lives in the service; this
 * layer only maps the path/query to the call. Errors are thrown as
 * {@link ApiError} and serialised to the §6 envelope by the shared handler.
 */
import type { FastifyInstance } from 'fastify';
import type { ReportingSummaryQuery, SummaryApi } from '../services/summaryService.js';
import { API_BASE_PATH } from './hierarchyRoutes.js';

interface ProgrammeParams {
  programmeId: string;
}

/** Register the leadership reporting-summary route against a {@link SummaryApi}. */
export function registerSummaryRoutes(app: FastifyInstance, api: SummaryApi): void {
  app.get<{ Params: ProgrammeParams; Querystring: ReportingSummaryQuery }>(
    `${API_BASE_PATH}/programmes/:programmeId/reporting-summary`,
    async (request) => {
      return api.getReportingSummary(request.params.programmeId, request.query);
    },
  );
}
