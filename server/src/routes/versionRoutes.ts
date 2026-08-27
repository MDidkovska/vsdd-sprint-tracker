/**
 * Version history, audit and comparison routes (task 7.8).
 *
 * Registers the §6 history/audit read endpoints under the `/api/v1` base path:
 *   GET /api/v1/teams/{teamId}/updates/{checkpointId}/versions  — version list
 *   GET /api/v1/updates/{versionId}                             — a single version
 *   GET /api/v1/updates/{versionId}/audit                       — audit trail
 *   GET /api/v1/updates/{versionId}/compare/{compareVersionId}  — field diff (R14.3)
 *
 * The routes depend only on the {@link VersionApi} contract, so the server can
 * be tested with a fake API (no MongoDB) and wired to the real service in
 * production. All resolution/validation logic lives in the service; this layer
 * only maps the path to the call. An unknown team/checkpoint/version becomes a
 * 404 NOT_FOUND and an invalid comparison a 400 VALIDATION_FAILED — both via the
 * shared §6 error handler in `server.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { VersionApi } from '../services/versionService.js';
import { API_BASE_PATH } from './draftRoutes.js';

interface TeamCheckpointParams {
  teamId: string;
  checkpointId: string;
}

interface VersionParams {
  versionId: string;
}

interface CompareParams {
  versionId: string;
  compareVersionId: string;
}

/** Register the version history / audit / comparison routes against a {@link VersionApi}. */
export function registerVersionRoutes(app: FastifyInstance, api: VersionApi): void {
  app.get<{ Params: TeamCheckpointParams }>(
    `${API_BASE_PATH}/teams/:teamId/updates/:checkpointId/versions`,
    async (request) => {
      return api.getVersions(request.params.teamId, request.params.checkpointId);
    },
  );

  app.get<{ Params: VersionParams }>(
    `${API_BASE_PATH}/updates/:versionId`,
    async (request) => {
      return api.getVersion(request.params.versionId);
    },
  );

  app.get<{ Params: VersionParams }>(
    `${API_BASE_PATH}/updates/:versionId/audit`,
    async (request) => {
      return api.getAudit(request.params.versionId);
    },
  );

  app.get<{ Params: CompareParams }>(
    `${API_BASE_PATH}/updates/:versionId/compare/:compareVersionId`,
    async (request) => {
      return api.compareVersions(
        request.params.versionId,
        request.params.compareVersionId,
      );
    },
  );
}
