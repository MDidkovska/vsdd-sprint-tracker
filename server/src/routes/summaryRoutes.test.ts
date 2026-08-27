/**
 * Unit tests for the leadership reporting-summary route (task 7.7).
 *
 * These use Fastify's `inject` (no network, no database) with a fake
 * {@link SummaryApi}, verifying the routing, path/query pass-through and
 * error-envelope mapping in isolation from MongoDB. Full-stack behaviour against
 * a real store is covered by summaryEndpoints.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { ReportingSummary } from '../domain/leadership.js';
import { ApiError } from '../http/errorEnvelope.js';
import { buildServer } from '../server.js';
import type { ReportingSummaryQuery, SummaryApi } from '../services/summaryService.js';

const EMPTY_SUMMARY: ReportingSummary = {
  summary: {
    teamCount: 0,
    submittedCount: 0,
    draftOrMissingCount: 0,
    leadershipAskCount: 0,
    reportingPeriodLabel: 'Sprint 14 · Week 1',
  },
  snapshot: {
    programme: { id: 'vsdd', name: 'VSDD', active: true },
    sprint: { id: 'S14', programmeId: 'vsdd', label: 'Sprint 14', startDate: '2026-08-24', endDate: '2026-09-04', status: 'CURRENT' },
    checkpoint: { id: 'C14-1', sprintId: 'S14', weekNumber: 1, opensAt: '2026-08-24T08:00:00Z', dueAt: '2026-08-28T16:00:00Z', closesAt: '2026-08-31T16:00:00Z', status: 'CURRENT' },
    streams: [],
  },
  filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
};

function fakeApi(overrides: Partial<SummaryApi> = {}): SummaryApi {
  return {
    getReportingSummary: async () => EMPTY_SUMMARY,
    ...overrides,
  };
}

function build(api: SummaryApi) {
  return buildServer(
    { checkReadiness: async () => true, summaries: api },
    { logLevel: 'silent' },
  );
}

describe('leadership reporting-summary route', () => {
  it('returns the reporting summary for the resolved programme/cycle', async () => {
    const app = build(fakeApi());
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/reporting-summary?sprintId=S14&checkpointId=C14-1',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ReportingSummary;
    expect(body.summary.reportingPeriodLabel).toBe('Sprint 14 · Week 1');
    expect(body.filters).toEqual({ streamId: 'ALL', rag: 'ALL', state: 'ALL' });
    await app.close();
  });

  it('passes the programmeId and query filters through to the API', async () => {
    let seenProgramme = '';
    let seenQuery: ReportingSummaryQuery | undefined;
    const app = build(
      fakeApi({
        getReportingSummary: async (programmeId, query) => {
          seenProgramme = programmeId;
          seenQuery = query;
          return EMPTY_SUMMARY;
        },
      }),
    );
    await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/other/reporting-summary?sprintId=S14&checkpointId=C14-1&streamId=MMM&rag=RED&state=DRAFT',
    });
    expect(seenProgramme).toBe('other');
    expect(seenQuery).toMatchObject({
      sprintId: 'S14',
      checkpointId: 'C14-1',
      streamId: 'MMM',
      rag: 'RED',
      state: 'DRAFT',
    });
    await app.close();
  });

  it('maps a VALIDATION_FAILED ApiError to a 400 error envelope', async () => {
    const app = build(
      fakeApi({
        getReportingSummary: async () => {
          throw ApiError.validation('The reporting cycle is required.', [
            { path: 'sprintId', message: 'A sprintId is required.' },
          ]);
        },
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/reporting-summary',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toMatchObject({
      error: { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'sprintId' }] },
    });
    expect(body.error.correlationId).toBeTruthy();
    await app.close();
  });

  it('maps a NOT_FOUND ApiError to a 404 error envelope', async () => {
    const app = build(
      fakeApi({
        getReportingSummary: async () => {
          throw ApiError.notFound('Programme "nope" was not found.');
        },
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/nope/reporting-summary?sprintId=S14&checkpointId=C14-1',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND', fieldErrors: [] } });
    await app.close();
  });

  it('does not register the route when no summary API is injected', async () => {
    const app = buildServer({ checkReadiness: async () => true }, { logLevel: 'silent' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/vsdd/reporting-summary?sprintId=S14&checkpointId=C14-1',
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
