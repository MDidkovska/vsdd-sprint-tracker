/**
 * HTTP notification client tests (task 9.1).
 *
 * Prove the default-runtime client talks to the real endpoints with the session
 * cookie (`credentials: 'include'`) and the shared API base URL, and surfaces an
 * explicit connection error (no silent mock fallback) on failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHttpNotificationClient,
  NotificationError,
  type NotificationClient,
} from './notificationClient';
import type { NotificationInbox } from '../../domain/notifications';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const inbox: NotificationInbox = {
  items: [
    {
      id: 'user-a::mmm-a::C14-1::DUE_SOON',
      programmeId: 'vsdd',
      recipientSubject: 'user-a',
      teamId: 'mmm-a',
      teamName: 'PTSB-VSDD MMM A',
      sprintId: 'S14',
      sprintLabel: 'Sprint 14',
      checkpointId: 'C14-1',
      weekNumber: 1,
      type: 'DUE_SOON',
      title: 'Update due soon',
      body: 'Due within the next 24 hours.',
      dueAt: '2026-08-28T16:00:00Z',
      deepLink: {
        view: 'team',
        programmeId: 'vsdd',
        streamId: 'MMM',
        teamId: 'mmm-a',
        sprintId: 'S14',
        weekNumber: 1,
      },
      createdAt: '2026-08-28T10:00:00Z',
    },
  ],
  unreadCount: 1,
};

function withFetch(mock: ReturnType<typeof vi.fn>): NotificationClient {
  vi.stubGlobal('fetch', mock);
  return createHttpNotificationClient('/api/v1');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpNotificationClient', () => {
  it('loads the inbox from GET /notifications with the session cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(inbox));
    const client = withFetch(fetchMock);

    const result = await client.getInbox();

    expect(result.unreadCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/notifications',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('marks one notification read via POST /notifications/:id/read', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...inbox.items[0], readAt: '2026-08-28T11:00:00Z' }));
    const client = withFetch(fetchMock);

    const updated = await client.markRead('user-a::mmm-a::C14-1::DUE_SOON');

    expect(updated.readAt).toBe('2026-08-28T11:00:00Z');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/notifications/user-a%3A%3Ammm-a%3A%3AC14-1%3A%3ADUE_SOON/read',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('marks all read via POST /notifications/read-all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ updated: 3 }));
    const client = withFetch(fetchMock);

    expect(await client.markAllRead()).toEqual({ updated: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/notifications/read-all',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('surfaces an explicit CONNECTION_ERROR when the backend is unreachable', async () => {
    const client = withFetch(vi.fn().mockRejectedValue(new TypeError('network down')));
    await expect(client.getInbox()).rejects.toBeInstanceOf(NotificationError);
    await expect(client.getInbox()).rejects.toMatchObject({ code: 'CONNECTION_ERROR' });
  });

  it('maps a 401 to SESSION_EXPIRED and a 404 to NOT_FOUND (no mock fallback)', async () => {
    const unauthorized = withFetch(
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'SESSION_EXPIRED' } }, 401)),
    );
    await expect(unauthorized.getInbox()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });

    const missing = withFetch(
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND' } }, 404)),
    );
    await expect(missing.markRead('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
