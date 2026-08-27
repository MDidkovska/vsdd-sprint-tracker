/**
 * Unit tests for the structured export route (task 7.10).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link ExportApi}, verifying routing, body validation, path/body
 * pass-through and error-envelope mapping in isolation from MongoDB.
 * Full-stack behaviour against a real store is covered by
 * exportEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ExportRequest, ExportSnapshot } from '../domain/exportSnapshot.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { ExportApi } from '../services/exportService.js';
import { buildServer } from '../server.js';

const EMPTY_SNAPSHOT: ExportSnapshot = {
  programme: 'VSDD',
  sprintId: 'S14',
  checkpointId: 'C14-1',
  reportingPeriodLabel: 'Sprint 14 · Week 1',
  filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
  recordCount: 0,
  exportedAt: '2026-08-26T09:14:00.000Z',
  records: [],
};

function validBody(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    sprintId: 'S14',
    checkpointId: 'C14-1',
    filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
    ...overrides,
  };
}

function fakeApi(overrides: Partial<ExportApi> = {}): ExportApi {
  return {
    createExport: async (): Promise<ExportSnapshot> => EMPTY_SNAPSHOT,
    ...overrides,
  };
}

function build(api: ExportApi) {
  return buildServer({ checkReadiness: async () => true, exports: api }, { logLevel: 'silent' });
}

describe('structured export route', () => {
  it('POST /programmes/:programmeId/exports returns the snapshot with a 200 status', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/vsdd/exports',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      programme: 'VSDD',
      reportingPeriodLabel: 'Sprint 14 · Week 1',
      recordCount: 0,
    });
    await app.close();
  });

  it('passes the programmeId and body through to the API', async () => {
    let seenProgramme = '';
    let seenRequest: ExportRequest | undefined;
    const app = build(
      fakeApi({
        createExport: async (programmeId, request) => {
          seenProgramme = programmeId;
          seenRequest = request;
          return EMPTY_SNAPSHOT;
        },
      }),
    );
    await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/other/exports',
      payload: validBody({ filters: { streamId: 'MMM', rag: 'RED', state: 'DRAFT' } }),
    });
    expect(seenProgramme).toBe('other');
    expect(seenRequest).toEqual({
      sprintId: 'S14',
      checkpointId: 'C14-1',
      filters: { streamId: 'MMM', rag: 'RED', state: 'DRAFT' },
    });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED when the body is missing the reporting cycle', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/vsdd/exports',
      payload: { filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('returns 400 VALIDATION_FAILED for an unknown filter enum value (schema)', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/vsdd/exports',
      payload: validBody({ filters: { streamId: 'ALL', rag: 'PURPLE' as never, state: 'ALL' } }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    await app.close();
  });

  it('maps a PERMISSION_DENIED ApiError to a 403 envelope', async () => {
    const app = build(
      fakeApi({
        createExport: async () => {
          throw new ApiError(
            'PERMISSION_DENIED',
            'You do not have permission to export this programme.',
          );
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/vsdd/exports',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    await app.close();
  });

  it('maps a NOT_FOUND ApiError to a 404 envelope', async () => {
    const app = build(
      fakeApi({
        createExport: async () => {
          throw ApiError.notFound('Programme "nope" was not found.');
        },
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/nope/exports',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    await app.close();
  });

  it('does not register the export route when no export API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/vsdd/exports',
      payload: validBody(),
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
