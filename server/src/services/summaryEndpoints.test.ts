/**
 * Full-stack integration tests for the leadership summary / filtered hierarchy
 * projection endpoint (task 7.7).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService},
 * {@link SubmitService} and {@link SummaryService} and the Fastify server, then
 * exercise `GET /api/v1/programmes/:programmeId/reporting-summary` with
 * `inject`. They verify the whole slice: the Programme -> Stream -> Team
 * projection, per-team cell-state resolution (Submitted / Draft / Missing /
 * Stale), the derived STALE fallback, stream/RAG/state filtering, the summary
 * counts recomputed against the filtered population, the empty-result case and
 * the §6 error envelope (R12, R13).
 *
 * Because the submit path is transactional, these tests run against an
 * in-process MongoDB REPLICA SET (`MongoMemoryReplSet`); a docker-compose
 * replica set can be used instead via `MONGO_TEST_URI`.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mockAuthContext } from '../auth/mockAuth.js';
import type { ReportingSummary } from '../domain/leadership.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { SubmitService } from './submitService.js';
import { SummaryService } from './summaryService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_summary_test';

function draftBody(overrides: Partial<DraftUpdateRequest> = {}): DraftUpdateRequest {
  return {
    revision: 0,
    rag: { business: 'GREEN', delivery: 'AMBER', release: 'AMBER' },
    goals: {
      business: 'Enable the September release journey.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests.',
      nextWeekCommitment: 'Confirm readiness.',
    },
    qualityEvidence: { planned: 120, executed: 84, passed: 79, openCritical: 1, blocked: 5, automationPercent: 18 },
    achievements: 'Execution reached 70% of plan.',
    aiValue: {
      useCase: 'AI-assisted test generation',
      measurableBenefit: '27% reduction in design effort',
      humanValidation: 'Test lead review',
      nextExperimentConstraint: 'Extend with human approval',
    },
    exceptions: [
      {
        id: 'exc-1',
        type: 'RISK',
        impact: 'Regression coverage still incomplete.',
        owner: 'a.owner',
        dueDate: '2026-08-30',
        decisionSupport: 'Approve extra test capacity.',
        status: 'OPEN',
      },
    ],
    leadershipAsk: 'None',
    ...overrides,
  };
}

/** Save a draft (revision 0 -> 1) and leave it in DRAFT state. */
async function saveDraft(
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest> = {},
): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ revision: 0, ...overrides }),
  });
  expect(response.statusCode).toBe(200);
}

/** Save then submit a draft, leaving it SUBMITTED with an immutable version. */
async function submit(
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest> = {},
): Promise<void> {
  await saveDraft(teamId, checkpointId, overrides);
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
    payload: draftBody({ revision: 1, ...overrides }),
  });
  expect(response.statusCode).toBe(200);
}

function getSummary(query: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/programmes/vsdd/reporting-summary?${query}`,
  });
}

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
  await repository.seedReferenceData(buildReferenceData());

  const drafts = new DraftService(repository, mockAuthContext);
  const submits = new SubmitService(repository, mockAuthContext);
  const summaries = new SummaryService(repository);
  app = buildServer(
    { checkReadiness: () => repository.ping(), drafts, submits, summaries },
    { logLevel: 'silent' },
  );

  // Seed a realistic mix of states for Sprint 14 / Week 1 (checkpoint C14-1):
  //  - mmm-a  : SUBMITTED, all-green, with a leadership ask.
  //  - mmm-b  : DRAFT (work in progress, not evidence), business RED.
  //  - visa   : nothing at C14-1 but a submission at the earlier C13-2 -> STALE.
  //  - the remaining five teams: MISSING.
  await submit('mmm-a', 'C14-1', {
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    leadershipAsk: 'Need a staffing decision for regression coverage.',
  });
  await saveDraft('mmm-b', 'C14-1', {
    rag: { business: 'RED', delivery: 'AMBER', release: 'AMBER' },
    leadershipAsk: 'None',
  });
  await submit('visa', 'C13-2', {
    rag: { business: 'AMBER', delivery: 'AMBER', release: 'AMBER' },
    leadershipAsk: 'None',
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await repository?.close();
  await replSet?.stop();
});

describe('GET /api/v1/programmes/:programmeId/reporting-summary', () => {
  it('projects the full Programme -> Stream -> Team tree with resolved states (R12)', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C14-1');
    expect(response.statusCode).toBe(200);
    const body = response.json() as ReportingSummary;

    // All five streams and eight teams are present with no filter applied.
    expect(body.snapshot.streams.map((s) => s.stream.id)).toEqual(['MMM', 'OAH', 'GRMB', 'O24', 'Visa']);
    const cells = body.snapshot.streams.flatMap((s) => s.teams);
    expect(cells).toHaveLength(8);

    const byTeam = new Map(cells.map((c) => [c.team.id, c.resolved]));
    expect(byTeam.get('mmm-a')?.cellState).toBe('SUBMITTED');
    expect(byTeam.get('mmm-a')?.isSubmittedEvidence).toBe(true);
    expect(byTeam.get('mmm-b')?.cellState).toBe('DRAFT');
    expect(byTeam.get('mmm-b')?.isSubmittedEvidence).toBe(false);

    // Missing teams carry a null RAG so they can never read as a false Green.
    expect(byTeam.get('grmb')?.cellState).toBe('MISSING');
    expect(byTeam.get('grmb')?.rag).toBeNull();
    expect(byTeam.get('grmb')?.isSubmittedEvidence).toBe(false);
  });

  it('derives STALE from the latest earlier submission and does not count it as evidence (R12.4)', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C14-1');
    const body = response.json() as ReportingSummary;
    const visa = body.snapshot.streams
      .flatMap((s) => s.teams)
      .find((c) => c.team.id === 'visa');
    expect(visa?.resolved.cellState).toBe('STALE');
    expect(visa?.resolved.isStale).toBe(true);
    expect(visa?.resolved.isSubmittedEvidence).toBe(false);
    // The stale content came from the earlier Week 2 checkpoint (C13-2).
    expect(visa?.resolved.sourceCheckpointId).toBe('C13-2');
    expect(visa?.resolved.sourceWeekNumber).toBe(2);
  });

  it('computes the summary counts and reporting period against the full population (R13.3)', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C14-1');
    const body = response.json() as ReportingSummary;
    expect(body.summary.teamCount).toBe(8);
    expect(body.summary.submittedCount).toBe(1); // only mmm-a
    expect(body.summary.draftOrMissingCount).toBe(7); // mmm-b draft + visa stale + 5 missing
    expect(body.summary.leadershipAskCount).toBe(1); // mmm-a
    expect(body.summary.reportingPeriodLabel).toBe('Sprint 14 · Week 1');
    expect(body.filters).toEqual({ streamId: 'ALL', rag: 'ALL', state: 'ALL' });
  });

  it('filters by update state and recomputes the summary (R13.1/R13.2)', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C14-1&state=SUBMITTED');
    const body = response.json() as ReportingSummary;
    const cells = body.snapshot.streams.flatMap((s) => s.teams);
    expect(cells.map((c) => c.team.id)).toEqual(['mmm-a']);
    expect(body.summary.teamCount).toBe(1);
    expect(body.summary.submittedCount).toBe(1);
    expect(body.summary.draftOrMissingCount).toBe(0);
    expect(body.filters.state).toBe('SUBMITTED');
  });

  it('filters by RAG across any dimension', async () => {
    const green = (await getSummary('sprintId=S14&checkpointId=C14-1&rag=GREEN')).json() as ReportingSummary;
    expect(green.snapshot.streams.flatMap((s) => s.teams).map((c) => c.team.id)).toEqual(['mmm-a']);

    const red = (await getSummary('sprintId=S14&checkpointId=C14-1&rag=RED')).json() as ReportingSummary;
    expect(red.snapshot.streams.flatMap((s) => s.teams).map((c) => c.team.id)).toEqual(['mmm-b']);
  });

  it('filters by stream id', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C14-1&streamId=Visa');
    const body = response.json() as ReportingSummary;
    expect(body.snapshot.streams).toHaveLength(1);
    expect(body.snapshot.streams[0]?.stream.id).toBe('Visa');
    expect(body.snapshot.streams[0]?.teams.map((c) => c.team.id)).toEqual(['visa']);
    expect(body.summary.teamCount).toBe(1);
  });

  it('returns an empty projection with zeroed counts when no team matches (R13.4)', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C14-1&streamId=GRMB&state=SUBMITTED');
    expect(response.statusCode).toBe(200);
    const body = response.json() as ReportingSummary;
    expect(body.snapshot.streams).toEqual([]);
    expect(body.summary.teamCount).toBe(0);
    expect(body.summary.submittedCount).toBe(0);
    // Filters are echoed so the client can build a clear reset-filters action.
    expect(body.filters).toEqual({ streamId: 'GRMB', rag: 'ALL', state: 'SUBMITTED' });
  });

  it('returns 404 for an unknown programme', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/programmes/missing/reporting-summary?sprintId=S14&checkpointId=C14-1',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 404 when the checkpoint does not belong to the sprint', async () => {
    const response = await getSummary('sprintId=S14&checkpointId=C13-2');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 400 when the reporting cycle is missing', async () => {
    const response = await getSummary('sprintId=S14');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('returns 400 for an unknown RAG or state filter value', async () => {
    const badRag = await getSummary('sprintId=S14&checkpointId=C14-1&rag=PURPLE');
    expect(badRag.statusCode).toBe(400);
    expect(badRag.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const badState = await getSummary('sprintId=S14&checkpointId=C14-1&state=NOPE');
    expect(badState.statusCode).toBe(400);
    expect(badState.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
