/**
 * Frontend notification client (Phase 9, task 9.1).
 *
 * A small, replaceable seam mirroring the backend notification API — the exact
 * counterpart of the auth client (`src/auth/authClient.ts`). The UI depends only
 * on the {@link NotificationClient} contract:
 *  - {@link createHttpNotificationClient} talks to the REAL backend with the
 *    session cookie (`credentials: 'include'`) and the shared API base URL. This
 *    is the DEFAULT runtime path.
 *  - {@link createMockNotificationClient} delegates to the in-memory mock
 *    repository, used ONLY when `VITE_AUTH_MODE=mock` (demo/tests).
 *
 * There is NO silent fallback to mock data: when the backend is unreachable the
 * HTTP client throws a connection error the UI surfaces explicitly (mirroring
 * the auth connection-error behaviour).
 */
import { resolveApiBaseUrl } from '../../auth/authClient';
import type { Repository } from '../../api/repository';
import type { Notification, NotificationInbox } from '../../domain/notifications';

/** Stable notification error codes surfaced to the UI. */
export type NotificationErrorCode =
  | 'CONNECTION_ERROR'
  | 'SESSION_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'SAVE_FAILED';

export class NotificationError extends Error {
  readonly code: NotificationErrorCode;
  constructor(code: NotificationErrorCode, message: string) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

export interface NotificationClient {
  getInbox(): Promise<NotificationInbox>;
  markRead(id: string): Promise<Notification>;
  markAllRead(): Promise<{ updated: number }>;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

function mapErrorCode(code: string | undefined, status: number): NotificationErrorCode {
  if (code === 'SESSION_EXPIRED' || code === 'UNAUTHENTICATED' || status === 401) {
    return 'SESSION_EXPIRED';
  }
  if (code === 'PERMISSION_DENIED' || status === 403) return 'PERMISSION_DENIED';
  if (code === 'NOT_FOUND' || status === 404) return 'NOT_FOUND';
  return 'SAVE_FAILED';
}

/** The real HTTP client — the DEFAULT runtime notification source. */
export function createHttpNotificationClient(
  baseUrl = resolveApiBaseUrl(),
): NotificationClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...init,
      });
    } catch {
      // Network / DNS / CORS failure: surface an explicit connection error —
      // never silently fall back to mock data.
      throw new NotificationError(
        'CONNECTION_ERROR',
        'Could not reach the server to load notifications.',
      );
    }
    if (!res.ok) {
      let code: string | undefined;
      let message = 'Notifications are unavailable. Please try again.';
      try {
        const body = (await res.json()) as ErrorEnvelope;
        code = body.error?.code;
        if (body.error?.message) message = body.error.message;
      } catch {
        // Non-JSON error; keep the defaults.
      }
      throw new NotificationError(mapErrorCode(code, res.status), message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getInbox: () => request<NotificationInbox>('/notifications', { method: 'GET' }),
    markRead: (id) =>
      request<Notification>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
    markAllRead: () => request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
  };
}

/**
 * The mock client (VITE_AUTH_MODE=mock only). Delegates to the in-memory mock
 * repository so demo/tests behave like the backend without a server.
 */
export function createMockNotificationClient(repository: Repository): NotificationClient {
  return {
    getInbox: () => repository.getNotifications(),
    markRead: (id) => repository.markNotificationRead(id),
    markAllRead: () => repository.markAllNotificationsRead(),
  };
}
