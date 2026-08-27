/**
 * Unit tests for the infrastructure endpoints.
 *
 * These use Fastify's `inject` (no network, no database) with a stubbed
 * readiness checker, verifying:
 *  - /health is always live and independent of the store;
 *  - /ready is 200 when the store answers and 503 when it is down or errors.
 */
import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('infrastructure endpoints', () => {
  it('GET /health returns 200 and status ok without checking the store', async () => {
    const app = buildServer(
      { checkReadiness: async () => false },
      { logLevel: 'silent' },
    );
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });

  it('GET /ready returns 200 when the store is reachable', async () => {
    const app = buildServer(
      { checkReadiness: async () => true },
      { logLevel: 'silent' },
    );
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
    await app.close();
  });

  it('GET /ready returns 503 when the store is not reachable', async () => {
    const app = buildServer(
      { checkReadiness: async () => false },
      { logLevel: 'silent' },
    );
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'not_ready' });
    await app.close();
  });

  it('GET /ready returns 503 when the readiness check throws', async () => {
    const app = buildServer(
      {
        checkReadiness: async () => {
          throw new Error('connection refused');
        },
      },
      { logLevel: 'silent' },
    );
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
