/**
 * Programme-hierarchy and reporting-cycle read routes (task 7.3).
 *
 * Registers the §6 read endpoints under the `/api/v1` base path:
 *   GET /api/v1/me                                  (identity / team context, R3)
 *   GET /api/v1/programmes/{programmeId}/hierarchy  (Programme -> Stream -> Team, R12)
 *   GET /api/v1/programmes/{programmeId}/sprints?status=current  (reporting cycle, R2)
 *
 * The routes depend only on the {@link HierarchyApi} contract, so the server
 * can be tested with a fake API (no MongoDB) and wired to the real service in
 * production. Errors are thrown as {@link ApiError} and serialised to the §6
 * envelope by the shared error handler in `server.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { HierarchyApi } from '../services/hierarchyService.js';
import { parseSprintStatus } from '../services/hierarchyService.js';

export const API_BASE_PATH = '/api/v1';

interface ProgrammeParams {
  programmeId: string;
}

interface SprintsQuery {
  status?: string;
}

/** Register the hierarchy/identity read routes against a {@link HierarchyApi}. */
export function registerHierarchyRoutes(app: FastifyInstance, api: HierarchyApi): void {
  app.get(`${API_BASE_PATH}/me`, async () => {
    return api.getCurrentUser();
  });

  app.get<{ Params: ProgrammeParams }>(
    `${API_BASE_PATH}/programmes/:programmeId/hierarchy`,
    async (request) => {
      return api.getHierarchy(request.params.programmeId);
    },
  );

  app.get<{ Params: ProgrammeParams; Querystring: SprintsQuery }>(
    `${API_BASE_PATH}/programmes/:programmeId/sprints`,
    async (request) => {
      const status = parseSprintStatus(request.query.status);
      return api.getSprints(request.params.programmeId, status);
    },
  );
}
