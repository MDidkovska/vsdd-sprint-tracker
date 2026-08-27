/**
 * Frontend CSRF double-submit helper tests (task 10.1).
 *
 * Prove the app reads the readable `vsdd_csrf` cookie and echoes it back in the
 * `X-CSRF-Token` header for state-changing requests only, and never for safe
 * methods or when no token is present yet.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CSRF_HEADER, csrfHeaders, readCsrfToken } from './csrf';

function clearCookies(): void {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

afterEach(() => {
  clearCookies();
});

describe('csrf frontend helper', () => {
  it('reads the token from document.cookie', () => {
    document.cookie = 'vsdd_csrf=abc123; Path=/';
    expect(readCsrfToken()).toBe('abc123');
  });

  it('returns undefined when no CSRF cookie is present', () => {
    document.cookie = 'other=1; Path=/';
    expect(readCsrfToken()).toBeUndefined();
  });

  it('adds the header for state-changing methods when a token exists', () => {
    document.cookie = 'vsdd_csrf=tok; Path=/';
    expect(csrfHeaders('POST')).toEqual({ [CSRF_HEADER]: 'tok' });
    expect(csrfHeaders('put')).toEqual({ [CSRF_HEADER]: 'tok' });
    expect(csrfHeaders('DELETE')).toEqual({ [CSRF_HEADER]: 'tok' });
  });

  it('never adds the header for safe methods', () => {
    document.cookie = 'vsdd_csrf=tok; Path=/';
    expect(csrfHeaders('GET')).toEqual({});
    expect(csrfHeaders('HEAD')).toEqual({});
    expect(csrfHeaders(undefined)).toEqual({});
  });

  it('omits the header when no token is available', () => {
    expect(csrfHeaders('POST')).toEqual({});
  });
});
