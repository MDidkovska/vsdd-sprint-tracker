/**
 * Read-only audit-history route (Phase 8 repair):
 *   GET /api/v1/audit?userId=&entityId=&action=&limit=&offset=
 *
 * Depends only on the {@link AuditApi} contract. Admin/Auditor authorisation is
 * enforced inside the service (and by the request hook's edge gate). The
 * response is a sanitised, newest-first, paginated projection with no password
 * hashes, session tokens or user-authored content.
 */
import type { FastifyInstance } from 'fastify';
import type { AuditApi } from '../services/auditService.js';

export const API_BASE_PATH = '/api/v1';

interface AuditQueryString {
  userId?: string;
  entityId?: string;
  action?: string;
  limit?: string;
  offset?: string;
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function registerAuditRoutes(app: FastifyInstance, api: AuditApi): void {
  app.get<{ Querystring: AuditQueryString }>(
    `${API_BASE_PATH}/audit`,
    async (request) => {
      const { userId, entityId, action } = request.query;
      return api.list({
        ...(userId ? { userId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(action ? { action } : {}),
        ...(toInt(request.query.limit) !== undefined ? { limit: toInt(request.query.limit) } : {}),
        ...(toInt(request.query.offset) !== undefined ? { offset: toInt(request.query.offset) } : {}),
      });
    },
  );
}
