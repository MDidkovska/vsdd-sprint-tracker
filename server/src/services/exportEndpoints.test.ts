/**
 * Full-stack integration tests for the structured export endpoint (task 7.10).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService},
 * {@link SubmitService}, {@link SummaryService} and {@link ExportService} and
 * the Fastify server, then exercise
 * `POST /api/v1/programmes/:programmeId/exports` with `inject`. They verify the
 * whole slice against requirements.md R16:
 *
 *  - the export reuses the leadership filtered projection so its records match
 *    the on-screen filtered population exactly (design.md §13 export scoping);
 *  - each record carries the reporting period, filter context, version
 *    timestamps, the three RAG labels, the four goals, quality evidence + the
 *    derived rates, the AI value, exceptions and the leadership ask (R16.2);
 *  - Draft / Missing / Stale rows are marked visibly and never read as current
 *    submitted evidence (R16.3);
 *  - the stream / RAG / state filters scope the export identically to the UI;
 *  - export access follows the same programme permission as the UI: a caller
 *    without Programme Leadership whole-programme access is refused with 403
 *    PERMISSION_DENIED and the request yields no programme data (R16.4,
 *    design.md §13 — no programme-data enumeration).
 *
 * Because the submit path is transactional, these tests run against an
 * in-process MongoDB REPLICA SET (`MongoMemoryReplSet`); a docker-compose
 * replica set can be used instead via `MONGO_TEST_URI`.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../auth/mockAuth.js';
import { mockAuthContext } from '../auth/mockAuth.js';
import type { CurrentUser } from '../domain/identity.js';
import type { ExportRequest, ExportSnapshot } from '../domain/exportSnapshot.js';
import { MOCK_CURRENT_USER, buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { ExportService } from './exportService.js';
import { SubmitService } from './submitService.js';
import { SummaryService } from './summaryService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
/** A second server whose caller lacks Programme Leadership whole-programme access. */
let unauthorisedApp: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_export_test';

/** A Contributor: assigned to teams but not Programme Leadership. */
const contributorAuth: AuthContext = {
  getCurrentUser(): CurrentUser {
    return {
      ...structuredClone(MOCK_CURRENT_USER),
      subject: 'user-contrib',
      roles: ['CONTRIBUTOR'],
      canViewAll: false,
    };
  },
};

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

function exportBody(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    sprintId: 'S14',
    checkpointId: 'C14-1',
    filters: { streamId: 'ALL', rag: 'ALL', state: 'ALL' },
    ...overrides,
  };
}

function createExport(body: ExportRequest, target: FastifyInstance = app) {
  return target.inject({
    method: 'POST',
    url: '/api/v1/programmes/vsdd/exports',
    payload: body,
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
  const exports = new ExportService(summaries, mockAuthContext, repository);
  app = buildServer(
    { checkReadiness: () => repository.ping(), drafts, submits, summaries, exports },
    { logLevel: 'silent' },
  );

  // A second server whose export API is gated by the Contributor auth context.
  unauthorisedApp = buildServer(
    {
      checkReadiness: () => repository.ping(),
      exports: new ExportService(summaries, contributorAuth, repository),
    },
    { logLevel: 'silent' },
  );

  // Same realistic mix of states as the summary suite for Sprint 14 / Week 1:
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
  await unauthorisedApp?.close();
  await repository?.close();
  await replSet?.stop();
});

describe('POST /api/v1/programmes/:programmeId/exports', () => {
  it('exports the full filtered population with reporting-period + filter context (R16.1/R16.2)', async () => {
    const response = await createExport(exportBody());
    expect(response.statusCode).toBe(200);
    const body = response.json() as ExportSnapshot;

    expect(body.programme).toBe('VSDD');
    expect(body.sprintId).toBe('S14');
    expect(body.checkpointId).toBe('C14-1');
    expect(body.reportingPeriodLabel).toBe('Sprint 14 · Week 1');
    expect(body.filters).toEqual({ streamId: 'ALL', rag: 'ALL', state: 'ALL' });
    expect(body.exportedAt).toBeTruthy();

    // All eight teams appear, matching the unfiltered leadership population.
    expect(body.recordCount).toBe(8);
    expect(body.records).toHaveLength(8);
  });

  it('includes the full update content for a submitted record (R16.2)', async () => {
    const body = (await createExport(exportBody())).json() as ExportSnapshot;
    const mmmA = body.records.find((r) => r.teamId === 'mmm-a');
    expect(mmmA).toBeDefined();
    expect(mmmA?.state).toBe('SUBMITTED');
    expect(mmmA?.isSubmittedEvidence).toBe(true);
    expect(mmmA?.streamName).toBe('MMM');

    // Version timestamps present for submitted evidence.
    expect(mmmA?.submittedAt).toBeTruthy();

    // The three RAG labels.
    expect(mmmA?.rag).toEqual({ business: 'GREEN', delivery: 'GREEN', release: 'GREEN' });

    // The four goals / commitments.
    expect(mmmA?.payload?.goals).toMatchObject({
      business: expect.any(String),
      technicalTesting: expect.any(String),
      sprintCommitment: expect.any(String),
      nextWeekCommitment: expect.any(String),
    });

    // Quality evidence + derived rates: executed/planned = 84/120 = 70,
    // passed/executed = 79/84 = 94.0 (rounded to 1 dp).
    expect(mmmA?.payload?.qualityEvidence.planned).toBe(120);
    expect(mmmA?.derivedRates).toEqual({ executionRate: 70, passRate: 94 });

    // AI value, exceptions and the leadership ask.
    expect(mmmA?.payload?.aiValue.useCase).toBe('AI-assisted test generation');
    expect(mmmA?.payload?.exceptions).toHaveLength(1);
    expect(mmmA?.payload?.leadershipAsk).toContain('staffing decision');
  });

  it('marks Draft, Missing and Stale rows visibly and never as current evidence (R16.3)', async () => {
    const body = (await createExport(exportBody())).json() as ExportSnapshot;
    const byTeam = new Map(body.records.map((r) => [r.teamId, r]));

    // Draft — shown, not evidence.
    const draft = byTeam.get('mmm-b');
    expect(draft?.state).toBe('DRAFT');
    expect(draft?.isSubmittedEvidence).toBe(false);
    expect(draft?.derivedRates).not.toBeNull();

    // Missing — null RAG / payload / derived rates so it can never read Green.
    const missing = byTeam.get('grmb');
    expect(missing?.state).toBe('MISSING');
    expect(missing?.isSubmittedEvidence).toBe(false);
    expect(missing?.rag).toBeNull();
    expect(missing?.payload).toBeNull();
    expect(missing?.derivedRates).toBeNull();

    // Stale — carried over from the earlier checkpoint, not current evidence.
    const stale = byTeam.get('visa');
    expect(stale?.state).toBe('STALE');
    expect(stale?.isStale).toBe(true);
    expect(stale?.isSubmittedEvidence).toBe(false);
    expect(stale?.sourceCheckpointId).toBe('C13-2');
    expect(stale?.sourceWeekNumber).toBe(2);
  });

  it('applies the stream / state filters so the export matches the on-screen population', async () => {
    const submitted = (
      await createExport(exportBody({ filters: { streamId: 'ALL', rag: 'ALL', state: 'SUBMITTED' } }))
    ).json() as ExportSnapshot;
    expect(submitted.records.map((r) => r.teamId)).toEqual(['mmm-a']);
    expect(submitted.recordCount).toBe(1);
    expect(submitted.filters.state).toBe('SUBMITTED');

    const visaOnly = (
      await createExport(exportBody({ filters: { streamId: 'Visa', rag: 'ALL', state: 'ALL' } }))
    ).json() as ExportSnapshot;
    expect(visaOnly.records.map((r) => r.teamId)).toEqual(['visa']);
  });

  it('returns an empty export when no team matches the filter', async () => {
    const body = (
      await createExport(exportBody({ filters: { streamId: 'GRMB', rag: 'ALL', state: 'SUBMITTED' } }))
    ).json() as ExportSnapshot;
    expect(body.recordCount).toBe(0);
    expect(body.records).toEqual([]);
  });

  it('refuses a caller without Programme Leadership access with 403 and returns no programme data (R16.4)', async () => {
    const response = await createExport(exportBody(), unauthorisedApp);
    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error.code).toBe('PERMISSION_DENIED');
    // No programme data leaks alongside the refusal.
    expect(body.records).toBeUndefined();
    expect(body.programme).toBeUndefined();
  });

  it('refuses an unauthorised caller identically for a non-existent programme (no enumeration, design.md §13)', async () => {
    const missingProgramme = await unauthorisedApp.inject({
      method: 'POST',
      url: '/api/v1/programmes/does-not-exist/exports',
      payload: exportBody(),
    });
    // Same 403 PERMISSION_DENIED as for a real programme — the caller cannot
    // tell whether the programme exists.
    expect(missingProgramme.statusCode).toBe(403);
    expect(missingProgramme.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('returns 404 for an unknown programme when the caller IS authorised', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/programmes/missing/exports',
      payload: exportBody(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 404 when the checkpoint does not belong to the sprint', async () => {
    const response = await createExport(exportBody({ checkpointId: 'C13-2' }));
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('appends an EXPORT_CREATED security-audit event for a successful export (R15)', async () => {
    const before = await repository.listAuditForAggregate('vsdd');

    const response = await createExport(
      exportBody({ filters: { streamId: 'ALL', rag: 'ALL', state: 'SUBMITTED' } }),
    );
    expect(response.statusCode).toBe(200);

    const after = await repository.listAuditForAggregate('vsdd');
    expect(after.length).toBe(before.length + 1);

    // Newest first — the new event is at the head of the aggregate trail.
    const event = after[0]!;
    expect(event.action).toBe('EXPORT_CREATED');
    expect(event.entityType).toBe('EXPORT');
    expect(event.programmeId).toBe('vsdd');
    expect(event.actorSubject).toBe('user-md');
    expect(event.correlationId).toBeTruthy();
    // The filter selection is recorded; NO user-authored update content leaks
    // into the audit metadata (design.md §14 / R15).
    expect(event.filterSummary).toContain('state=SUBMITTED');
    expect(event.filterSummary).not.toContain('staffing decision');
    expect(event.reason).toBeUndefined();
  });

  it('writes NO success audit event when the export is denied (R15)', async () => {
    const before = await repository.listAuditForAggregate('vsdd');

    const denied = await createExport(exportBody(), unauthorisedApp);
    expect(denied.statusCode).toBe(403);

    const after = await repository.listAuditForAggregate('vsdd');
    expect(after.length).toBe(before.length);
    expect(after.some((e) => e.action === 'EXPORT_CREATED' && e.actorSubject === 'user-contrib')).toBe(
      false,
    );
  });
});
