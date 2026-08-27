/**
 * Full-stack integration tests for the atomic submit endpoint (task 7.5).
 *
 * These wire the REAL MongoDB adapter to the real {@link DraftService} +
 * {@link SubmitService} and the Fastify server, then exercise
 * `POST /api/v1/teams/:teamId/drafts/:checkpointId/submit` with `inject`.
 *
 * Because the submit path is transactional (the draft transition, the immutable
 * version append and the audit append are one atomic unit), these tests run
 * against an in-process MongoDB REPLICA SET (`MongoMemoryReplSet`) — standalone
 * MongoDB does not support multi-document transactions. A docker-compose replica
 * set can be used instead via `MONGO_TEST_URI`.
 *
 * Covered:
 *  - a successful submit creates an immutable version + audit event atomically
 *    and transitions the draft to SUBMITTED (R11.2, R14.1, R14.2);
 *  - a submission that fails required-field validation returns 400 and creates
 *    nothing (R4–R10);
 *  - a stale revision returns 409 and creates nothing (R11.5);
 *  - a submitted update is read-only: resubmitting returns 409 ALREADY_SUBMITTED
 *    and the immutable version is unchanged (R11.3).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mockAuthContext } from '../auth/mockAuth.js';
import { docKey, type UpdateDocument } from '../domain/documents.js';
import { buildReferenceData } from '../reference/referenceData.js';
import { MongoDocumentRepository } from '../repository/mongoDocumentRepository.js';
import { buildServer } from '../server.js';
import { DraftService, type DraftUpdateRequest } from './draftService.js';
import { SubmitService } from './submitService.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let app: FastifyInstance;
let uri: string;
const dbName = 'vsdd_poc_submit_test';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    // A single-member replica set is enough to enable transactions locally.
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
  await repository.seedReferenceData(buildReferenceData());

  const drafts = new DraftService(repository, mockAuthContext);
  const submits = new SubmitService(repository, mockAuthContext);
  app = buildServer(
    { checkReadiness: () => repository.ping(), drafts, submits },
    { logLevel: 'silent' },
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await repository?.close();
  await replSet?.stop();
});

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

/** Create a draft at revision 1 for a team+checkpoint and return the document. */
async function createDraft(
  teamId: string,
  checkpointId: string,
  overrides: Partial<DraftUpdateRequest> = {},
): Promise<UpdateDocument> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
    payload: draftBody({ revision: 0, ...overrides }),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as UpdateDocument;
}

describe('POST /api/v1/teams/:teamId/drafts/:checkpointId/submit', () => {
  it('atomically creates an immutable version + audit event and marks the draft SUBMITTED', async () => {
    const teamId = 'mmm-a';
    const checkpointId = 'C14-1';
    const draft = await createDraft(teamId, checkpointId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: draft.revision }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { document: UpdateDocument; version: Record<string, unknown> };
    expect(body.document.state).toBe('SUBMITTED');
    expect(body.document.revision).toBe(draft.revision + 1);
    expect(body.document.submittedAt).toBeTruthy();
    expect(response.headers.etag).toBe(`"${body.document.revision}"`);

    // The immutable version snapshot was created and retained (R14.1).
    expect(body.version.versionNumber).toBe(1);
    expect(body.version.submittedBy).toBe('user-md');
    const id = docKey(teamId, draft.sprintId, checkpointId);
    expect(body.version.id).toBe(`${teamId}-${draft.sprintId}-${checkpointId}-v1`);

    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(1);

    // The audit event was appended for the same submission (R14.2, R14.4).
    const audit = await repository.listAudit(body.version.id as string);
    expect(audit.some((event) => event.action === 'SUBMITTED')).toBe(true);
    const submittedEvent = audit.find((event) => event.action === 'SUBMITTED');
    expect(submittedEvent?.actorSubject).toBe('user-md');
    expect(submittedEvent?.newVersion).toBe(body.document.revision);

    // The stored draft aggregate is now SUBMITTED.
    const stored = await repository.getDraft(id);
    expect(stored?.state).toBe('SUBMITTED');
  });

  it('rejects a submission missing required fields with 400 and creates nothing (R4-R10)', async () => {
    const teamId = 'mmm-b';
    const checkpointId = 'C14-1';
    const draft = await createDraft(teamId, checkpointId);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({
        revision: draft.revision,
        // Missing business goal + achievements -> submission validation fails.
        goals: {
          business: '   ',
          technicalTesting: 'Close critical regression gaps.',
          sprintCommitment: 'Execute committed tests.',
          nextWeekCommitment: 'Confirm readiness.',
        },
        achievements: '',
      }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    const paths = body.error.fieldErrors.map((e: { path: string }) => e.path);
    expect(paths).toContain('goals.business');
    expect(paths).toContain('achievements');

    // Nothing was created: no version, and the draft is still an editable DRAFT.
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(0);
    const stored = await repository.getDraft(docKey(teamId, draft.sprintId, checkpointId));
    expect(stored?.state).toBe('DRAFT');
  });

  it('rejects a stale revision with 409 and creates nothing (R11.5)', async () => {
    const teamId = 'oah-ils';
    const checkpointId = 'C14-1';
    await createDraft(teamId, checkpointId); // revision 1

    // A second writer advances the draft 1 -> 2.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}`,
      payload: draftBody({ revision: 1, achievements: 'second-writer content' }),
    });

    // Submitting with the stale revision 1 must conflict.
    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: 1 }),
    });

    expect(stale.statusCode).toBe(409);
    const body = stale.json();
    expect(body).toMatchObject({
      error: { code: 'DRAFT_REVISION_CONFLICT' },
      server: { revision: 2 },
    });

    // The atomic unit rolled back: no version created, draft still DRAFT at rev 2.
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(0);
    const stored = await repository.getDraft(docKey(teamId, 'S14', checkpointId));
    expect(stored?.state).toBe('DRAFT');
    expect(stored?.revision).toBe(2);
  });

  it('treats a submitted update as read-only: resubmitting returns 409 ALREADY_SUBMITTED (R11.3)', async () => {
    const teamId = 'grmb';
    const checkpointId = 'C14-1';
    const draft = await createDraft(teamId, checkpointId);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: draft.revision }),
    });
    expect(first.statusCode).toBe(200);
    const submitted = (first.json() as { document: UpdateDocument }).document;

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/drafts/${checkpointId}/submit`,
      payload: draftBody({ revision: submitted.revision }),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ALREADY_SUBMITTED');

    // The immutable history still holds exactly one version.
    const versions = await repository.listVersions(teamId, checkpointId);
    expect(versions).toHaveLength(1);
  });
});
