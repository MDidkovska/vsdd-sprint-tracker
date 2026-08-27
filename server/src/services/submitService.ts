/**
 * Atomic submit service (task 7.5).
 *
 * The vendor-neutral business layer behind the submit endpoint (design.md §6):
 *   POST /api/v1/teams/{teamId}/drafts/{checkpointId}/submit
 *
 * Submitting a Team Update (R11.2):
 *   1. validates the full required-field + cross-field contract (R4–R10) via the
 *      shared Phase 2 domain validation — a failure is a 400 VALIDATION_FAILED
 *      with per-field errors and creates nothing;
 *   2. builds the immutable {@link UpdateVersion} snapshot, the SUBMITTED draft
 *      envelope and the append-only {@link AuditEvent};
 *   3. persists all three ATOMICALLY through the repository's `submitUpdate`
 *      operation under the optimistic-concurrency (`revision`/ETag) guard.
 *
 * A submitted update is read-only until reopened (R11.3): resubmitting a
 * SUBMITTED document is rejected with ALREADY_SUBMITTED. A stale revision
 * returns 409 DRAFT_REVISION_CONFLICT and creates nothing (R11.5). Every
 * submitted version is retained and the audit event records actor, timestamp,
 * action, entity id, previous and new version (R14.1, R14.2, R14.4).
 *
 * Like the draft service, this depends only on a narrow repository *port* and
 * the mocked auth context — never on MongoDB (design.md §4b). Team-scoped
 * authorisation is Phase 8 (task 8.3), so it does not yet enforce role/
 * assignment scoping; it resolves the actor from the mocked subject.
 */
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../auth/mockAuth.js';
import {
  CURRENT_SCHEMA_VERSION,
  deriveEnvelopeFlags,
  docKey,
  type AuditEvent,
  type UpdateDocument,
  type UpdateVersion,
} from '../domain/documents.js';
import type { ReportingCheckpoint, Sprint, Team } from '../domain/hierarchy.js';
import { validateSubmission } from '../domain/validation.js';
import { ApiError, DraftRevisionConflictError } from '../http/errorEnvelope.js';
import type { SubmitDraftInput, SubmitOutcome } from '../repository/documentRepository.js';
import { buildPayload, type DraftUpdateRequest } from './draftService.js';

/**
 * The narrow slice of the repository the submit flow needs. Declaring it here
 * keeps the service decoupled and trivially fakeable in unit tests.
 */
export interface SubmitRepositoryPort {
  getTeam(teamId: string): Promise<Team | null>;
  getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null>;
  getSprint(sprintId: string): Promise<Sprint | null>;
  getDraft(id: string): Promise<UpdateDocument | null>;
  listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;
  submitUpdate(input: SubmitDraftInput): Promise<SubmitOutcome>;
}

/** The successful submit result (mirrors OpenAPI SubmitResult / mock repo). */
export interface SubmitResult {
  document: UpdateDocument;
  version: UpdateVersion;
}

/** Public API consumed by the HTTP route. */
export interface SubmitApi {
  submit(
    teamId: string,
    checkpointId: string,
    request: DraftUpdateRequest,
  ): Promise<SubmitResult>;
}

interface SubmitContext {
  team: Team;
  checkpoint: ReportingCheckpoint;
  sprint: Sprint;
}

export class SubmitService implements SubmitApi {
  private readonly repository: SubmitRepositoryPort;
  private readonly auth: AuthContext;

  constructor(repository: SubmitRepositoryPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async submit(
    teamId: string,
    checkpointId: string,
    request: DraftUpdateRequest,
  ): Promise<SubmitResult> {
    const context = await this.resolveContext(teamId, checkpointId);
    const id = docKey(teamId, context.sprint.id, checkpointId);
    const subject = this.auth.getCurrentUser().subject;

    const existing = await this.repository.getDraft(id);

    // R11.3 — a submitted update is read-only until reopened.
    if (existing?.state === 'SUBMITTED') {
      throw new ApiError(
        'ALREADY_SUBMITTED',
        'This update is submitted and immutable. Reopen it before editing or resubmitting.',
      );
    }

    // R4–R10 — full submission validation. A failure creates nothing.
    const payload = buildPayload(request);
    const fieldErrors = validateSubmission(request.rag, payload);
    if (fieldErrors.length > 0) {
      throw ApiError.validation(
        'This update is missing required information. Fix the highlighted fields and submit again.',
        fieldErrors,
      );
    }

    const flags = deriveEnvelopeFlags(payload);
    const now = new Date().toISOString();

    // Version number is one past the existing history for this team+checkpoint
    // (R14.1 — every submission is retained; a reopen+resubmit adds v2, v3, …).
    const priorVersions = await this.repository.listVersions(teamId, checkpointId);
    const versionNumber = priorVersions.length + 1;

    const version: UpdateVersion = {
      id: `${teamId}-${context.sprint.id}-${checkpointId}-v${versionNumber}`,
      programmeId: context.sprint.programmeId,
      streamId: context.team.streamId,
      teamId,
      sprintId: context.sprint.id,
      checkpointId,
      versionNumber,
      submittedBy: subject,
      submittedAt: now,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: request.rag,
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      payload,
    };

    const document: Omit<UpdateDocument, 'revision'> = {
      id,
      programmeId: context.sprint.programmeId,
      streamId: context.team.streamId,
      teamId,
      sprintId: context.sprint.id,
      checkpointId,
      state: 'SUBMITTED',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: request.rag,
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: subject,
      submittedAt: now,
      payload,
    };

    // R14.2/R14.4 — append-only audit record: actor, timestamp, action, entity
    // id, previous version (draft revision) and new version (submitted revision).
    const nextRevision = request.revision + 1;
    const audit: AuditEvent = {
      id: randomUUID(),
      programmeId: context.sprint.programmeId,
      // Shared update-aggregate key so every submission of this update joins the
      // same unified audit history as its reopen/decision events.
      aggregateId: id,
      entityType: 'VERSION',
      entityId: version.id,
      action: 'SUBMITTED',
      actorSubject: subject,
      timestamp: now,
      previousVersion: existing?.revision,
      newVersion: nextRevision,
      correlationId: randomUUID(),
    };

    const outcome = await this.repository.submitUpdate({
      document,
      version,
      audit,
      expectedRevision: request.revision,
    });

    if (!outcome.ok) {
      // Stale revision: surface the server's current metadata; create nothing.
      throw new DraftRevisionConflictError(outcome.server);
    }
    return { document: outcome.document, version: outcome.version };
  }

  /** Resolve and validate the team, checkpoint and owning sprint from the path. */
  private async resolveContext(
    teamId: string,
    checkpointId: string,
  ): Promise<SubmitContext> {
    const [team, checkpoint] = await Promise.all([
      this.repository.getTeam(teamId),
      this.repository.getCheckpoint(checkpointId),
    ]);
    if (!team) {
      throw ApiError.notFound(`Team "${teamId}" was not found.`);
    }
    if (!checkpoint) {
      throw ApiError.notFound(`Reporting checkpoint "${checkpointId}" was not found.`);
    }
    const sprint = await this.repository.getSprint(checkpoint.sprintId);
    if (!sprint) {
      throw ApiError.notFound(`Sprint "${checkpoint.sprintId}" was not found.`);
    }
    return { team, checkpoint, sprint };
  }
}
