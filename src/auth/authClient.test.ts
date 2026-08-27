/**
 * HTTP auth client tests (Phase 8 repair): proves the real client sends the
 * session cookie (credentials: 'include'), maps the §6 error envelope to an
 * AuthError, and treats 401 on /me as anonymous (null) — never a silent mock
 * fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, createHttpAuthClient } from './authClient';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createHttpAuthClient', () => {
  it('sends credentials and returns the principal on login', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse(200, { subject: 'u1', email: 'u1@x', status: 'ACTIVE', roles: ['TEAM_LEAD'] }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAuthClient('/api/v1');
    const user = await client.login({ email: 'u1@x', password: 'password123' });
    expect(user.subject).toBe('u1');

    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toBe('/api/v1/auth/login');
    expect(call[1]?.credentials).toBe('include');
  });

  it('echoes the CSRF token in the X-CSRF-Token header on state-changing requests', async () => {
    document.cookie = 'vsdd_csrf=csrf-tok; Path=/';
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, {})),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAuthClient('/api/v1');
    await client.logout();

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('csrf-tok');
    document.cookie = 'vsdd_csrf=; Max-Age=0; Path=/';
  });

  it('treats 401 on /me as anonymous (null), not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { code: 'SESSION_EXPIRED' } })));
    const client = createHttpAuthClient('/api/v1');
    expect(await client.getMe()).toBeNull();
  });

  it('maps an error envelope to an AuthError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { error: { code: 'EMAIL_TAKEN', message: 'taken' } })),
    );
    const client = createHttpAuthClient('/api/v1');
    await expect(
      client.register({ displayName: 'X', email: 'x@x', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('throws (does not fall back) on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const client = createHttpAuthClient('/api/v1');
    await expect(client.getMe()).rejects.toBeInstanceOf(Error);
  });

  it('builds the audit query string with filters', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(200, { items: [], total: 0, limit: 50, offset: 0 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpAuthClient('/api/v1');
    await client.listAudit({ action: 'USER_APPROVED', limit: 10 });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/audit?');
    expect(url).toContain('action=USER_APPROVED');
  });
});

// A tiny guard so AuthError stays importable/typed.
it('AuthError carries a code', () => {
  expect(new AuthError('AUTH_FAILED', 'x').code).toBe('AUTH_FAILED');
});
