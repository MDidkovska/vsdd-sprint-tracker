/**
 * Tests for the structured application logger (task 10.2, design.md §2 / §5a).
 *
 * These prove that the log stream produced for representative flows keeps ONLY
 * structured operational metadata — method, url, status code, timing and stable
 * ids — and NEVER a password, a session token / cookie or free-text,
 * user-authored update content. Log output is captured via a test destination
 * stream wired through `buildServer({ logStream })`, so the assertions run
 * against the exact bytes pino would write in production.
 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { PublicUser } from '../domain/accounts.js';
import type { CurrentUser } from '../domain/identity.js';
import { ApiError } from './errorEnvelope.js';
import {
  LOG_REDACTION_CENSOR,
  SENSITIVE_LOG_PATHS,
  buildLoggerOptions,
  serializeError,
} from './logger.js';
import type { AuthApi } from '../services/authService.js';
import { buildServer } from '../server.js';

/** A destination stream that accumulates every log line pino writes. */
function captureStream(): { stream: Writable; text(): string; lines(): unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  return {
    stream,
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown),
  };
}

const PRINCIPAL: CurrentUser = {
  subject: 'user-1',
  email: 'lead@example.com',
  displayName: 'Team Lead',
  initials: 'TL',
  roleLabel: 'Team Lead',
  status: 'ACTIVE',
  programmeId: 'prog-1',
  roles: ['TEAM_LEAD'],
  assignedTeamIds: ['team-1'],
  canViewAll: false,
};

const PUBLIC_USER: PublicUser = {
  id: 'user-1',
  email: 'lead@example.com',
  displayName: 'Team Lead',
  status: 'PENDING',
  roles: [],
  teamIds: [],
  programmeId: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const SESSION_TOKEN = 'SUPERSECRETSESSIONTOKEN0000000000000000000';
const PASSWORD = 'SUPERSECRETPASSWORD!';
const FREE_TEXT_GOAL = 'DELIVER THE PAYMENTS MIGRATION BY FRIDAY';

/** A fake auth API that exercises the real register/login/logout routes. */
function fakeAuth(): AuthApi {
  return {
    register: async () => PUBLIC_USER,
    login: async () => ({
      principal: PRINCIPAL,
      token: SESSION_TOKEN,
      expiresAt: '2024-01-01T12:00:00.000Z',
    }),
    logout: async () => {},
  };
}

describe('structured logger configuration', () => {
  it('exposes the sensitive redaction paths and censor', () => {
    expect(SENSITIVE_LOG_PATHS).toContain('req.headers.cookie');
    expect(SENSITIVE_LOG_PATHS).toContain('req.headers.authorization');
    expect(SENSITIVE_LOG_PATHS).toContain('res.headers["set-cookie"]');
    expect(SENSITIVE_LOG_PATHS).toContain('password');
    expect(SENSITIVE_LOG_PATHS).toContain('token');
    expect(LOG_REDACTION_CENSOR).toBe('[REDACTED]');

    const options = buildLoggerOptions('info') as {
      level: string;
      redact: { paths: string[]; censor: string };
      serializers: Record<string, unknown>;
    };
    expect(options.level).toBe('info');
    expect(options.redact.paths).toEqual(SENSITIVE_LOG_PATHS);
    expect(options.serializers.req).toBeTypeOf('function');
    expect(options.serializers.res).toBeTypeOf('function');
    expect(options.serializers.err).toBeTypeOf('function');
  });
});

describe('serializeError', () => {
  it('keeps only a fixed, safe shape and drops arbitrary properties', () => {
    const error = new ApiError('VALIDATION_FAILED', 'The request was invalid.', [
      { path: 'password', message: 'must be at least 12 characters' },
    ]);
    // Simulate an error that accidentally carries sensitive context.
    (error as unknown as Record<string, unknown>).password = PASSWORD;
    (error as unknown as Record<string, unknown>).requestBody = {
      businessGoal: FREE_TEXT_GOAL,
    };

    const serialized = serializeError(error) as unknown as Record<string, unknown>;

    expect(serialized).toMatchObject({
      type: 'ApiError',
      message: 'The request was invalid.',
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
    // Field errors keep the PATH + validation message, never a submitted value.
    expect(serialized.fieldErrors).toEqual([
      { path: 'password', message: 'must be at least 12 characters' },
    ]);
    // Arbitrary attached properties never survive serialization.
    expect(serialized.password).toBeUndefined();
    expect(serialized.requestBody).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain(PASSWORD);
    expect(JSON.stringify(serialized)).not.toContain(FREE_TEXT_GOAL);
  });
});

describe('application log stream never leaks secrets', () => {
  it('logs request metadata for login without the password, cookie or session token', async () => {
    const capture = captureStream();
    const app = buildServer(
      {
        checkReadiness: async () => true,
        auth: fakeAuth(),
        authConfig: { secureCookies: false, sessionTtlSeconds: 3600 },
      },
      { logLevel: 'info', logStream: capture.stream },
    );
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        cookie: `vsdd_session=${SESSION_TOKEN}`,
        authorization: 'Bearer LEAKED_BEARER_TOKEN',
      },
      payload: { email: 'lead@example.com', password: PASSWORD },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    // The response carries the session token in the cookie …
    expect(response.headers['set-cookie']).toContain(SESSION_TOKEN);

    const text = capture.text();
    // … but the log stream retains only operational metadata.
    expect(text).toContain('POST');
    expect(text).toContain('/api/v1/auth/login');
    expect(text).toContain('"statusCode":200');
    // and never the password, session token, bearer header or raw cookie.
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(SESSION_TOKEN);
    expect(text).not.toContain('LEAKED_BEARER_TOKEN');
  });

  it('never logs free-text update content or request bodies', async () => {
    const capture = captureStream();
    const app = buildServer(
      { checkReadiness: async () => true },
      { logLevel: 'info', logStream: capture.stream },
    );
    // A representative draft-save style endpoint carrying free-text content.
    app.post('/api/v1/test/draft', async () => ({ ok: true }));
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/test/draft',
      payload: {
        businessGoal: FREE_TEXT_GOAL,
        achievements: 'Shipped the reconciliation report',
        leadershipAsk: 'Need a decision on the vendor contract',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const text = capture.text();
    expect(text).toContain('/api/v1/test/draft');
    expect(text).toContain('"statusCode":200');
    expect(text).not.toContain(FREE_TEXT_GOAL);
    expect(text).not.toContain('Shipped the reconciliation report');
    expect(text).not.toContain('vendor contract');
  });

  it('redacts sensitive fields from an ad-hoc logged object', async () => {
    const capture = captureStream();
    const app = buildServer(
      { checkReadiness: async () => true },
      { logLevel: 'info', logStream: capture.stream },
    );
    app.get('/api/v1/test/adhoc', async (request) => {
      request.log.info(
        {
          teamId: 'team-1',
          event: 'DRAFT_SAVED',
          password: PASSWORD,
          token: SESSION_TOKEN,
          input: { password: 'NESTED_SECRET' },
        },
        'draft saved',
      );
      return { ok: true };
    });
    await app.ready();

    await app.inject({ method: 'GET', url: '/api/v1/test/adhoc' });
    await app.close();

    const text = capture.text();
    // Structured operational metadata is retained.
    expect(text).toContain('"teamId":"team-1"');
    expect(text).toContain('"event":"DRAFT_SAVED"');
    // Credentials and tokens are censored, at the top level and one level deep.
    expect(text).toContain(LOG_REDACTION_CENSOR);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(SESSION_TOKEN);
    expect(text).not.toContain('NESTED_SECRET');
  });

  it('logs errors as structured metadata without leaking attached context', async () => {
    const capture = captureStream();
    const app = buildServer(
      { checkReadiness: async () => true },
      { logLevel: 'info', logStream: capture.stream },
    );
    app.get('/api/v1/test/boom', async () => {
      const error = new Error('unexpected failure');
      // Simulate sensitive context clinging to the error.
      (error as unknown as Record<string, unknown>).password = PASSWORD;
      (error as unknown as Record<string, unknown>).body = {
        businessGoal: FREE_TEXT_GOAL,
      };
      throw error;
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/v1/test/boom' });
    await app.close();

    expect(response.statusCode).toBe(500);
    const text = capture.text();
    // The error is logged (type + message + stack) …
    expect(text).toContain('unexpected failure');
    expect(text).toContain('"statusCode":500');
    // … but attached credentials / free-text content never make it in.
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(FREE_TEXT_GOAL);
  });
});
