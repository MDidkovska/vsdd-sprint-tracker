/**
 * In-app notification routes (Phase 9, task 9.1).
 *
 * Registers the notification endpoints under the `/api/v1` base path:
 *   GET  /api/v1/notifications            — the caller's inbox (+ unread count)
 *   POST /api/v1/notifications/{id}/read  — mark one notification read (200)
 *   POST /api/v1/notifications/read-all   — mark all unread read     (200)
 *
 * All three are `authed-active` (the global auth hook requires a valid session
 * and an ACTIVE account). Per-recipient scoping is enforced inside the service,
 * so a caller only ever lists/marks their OWN notifications. The routes depend
 * only on the {@link NotificationApi} contract, so they can be tested with a
 * fake API and wired to the real service in production.
 */
import type { FastifyInstance } from 'fastify';
import type { NotificationApi } from '../services/notificationService.js';
import { API_BASE_PATH } from './draftRoutes.js';

interface NotificationParams {
  id: string;
}

/** Register the notification routes against a {@link NotificationApi}. */
export function registerNotificationRoutes(
  app: FastifyInstance,
  api: NotificationApi,
): void {
  app.get(`${API_BASE_PATH}/notifications`, async () => {
    return api.getInbox();
  });

  app.post<{ Params: NotificationParams }>(
    `${API_BASE_PATH}/notifications/:id/read`,
    async (request) => {
      return api.markRead(request.params.id);
    },
  );

  app.post(`${API_BASE_PATH}/notifications/read-all`, async () => {
    return api.markAllRead();
  });
}
