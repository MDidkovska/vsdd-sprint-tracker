/**
 * Authorised reopen service (task 7.6).
 *
 * The vendor-neutral business layer behind the reopen endpoint (design.md §6):
 *   POST /api/v1/updates/{versionId}/reopen
 *
 * Reopening a submitted update (R2.3, R11.3):
 *   1. requires a mandatory, non-empty reason — a missing/whitespace-only reason
 *      is a 400 VALIDATION_FAILED and changes nothing;
 *   2. resolves the immutable {@link UpdateVersion} by id — an unknown version is
 *      a 404 NOT_FOUND;
 *   3. is gated on an authorised role: only an assigned Team Lead may reopen
 *      (requirements.md R1 role matrix, R1.4 — the gate is enforced server-side,
 *      never by hiding a UI control). An unauthorised caller is a 403
 *      PERMISSION_DENIED;
 *   3b. is gated on the aggregate lifecycle (state machine §5): the current
 *      mutable aggregate must exist and be SUBMITTED, and the version being
 *      reopened must be the LATEST submitted version. A second reopen (already
 *      REOPENED), a DRAFT/MISSING aggregate, or an older superseded version are
 *      each a 409 INVALID_STATE that changes nothing;
 *   4. copies the latest submitted version's content into a NEW editable draft in
 *      the REOPENED state (state machine §5), incrementing the revision under the
 *      optimistic-concurrency guard (consistent with task 7.4);
 *   5. appends an append-only {@link AuditEvent} (action REOPENED) capturing the
 *      actor, timestamp, entity id, previous version, new version and the reason
 *      (R11.4, R14.1, R14.2).
 *
 * The latest submitted {@link UpdateVersion} is NEVER mutated or deleted — it
 * remains immutable and visible (R11.4). The draft transition and the audit
 * append happen atomically through the repository's `reopenUpdate` operation.
 *
 * Like the draft/submit services, this depends only on a narrow repository
 * *port* and the mocked auth context — never on MongoDB (design.md §4b).
 * Authentication is mocked for the PoC (Phase 8 handles real OIDC), but the
 * authorised-role gate is enforced here on the server.
 */
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../auth/mockAuth.js';
import {
  CURRENT_SCHEMA_VERSION,
  docKey,
  type AuditEvent,
  type UpdateDocument,
  type UpdateVersion,
} from '../domain/documents.js';
import { ApiError, DraftRevisionConflictError } from '../http/errorEnvelope.js';
import type { ReopenOutcome, ReopenUpdateInput } from '../repository/documentRepository.js';

/**
 * The narrow slice of the repository the reopen flow needs. Declaring it here
 * keeps the service decoupled and trivially fakeable in unit tests.
 */
export interface ReopenRepositoryPort {
  getVersion(id: string): Promise<UpdateVersion | null>;
  getDraft(id: string): Promise<UpdateDocument | null>;
  /** Submitted versions for a team + checkpoint, newest first. */
  listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;
  reopenUpdate(input: ReopenUpdateInput): Promise<ReopenOutcome>;
}

/** The reopen request contract (design.md §6 / OpenAPI ReopenRequest). */
export interface ReopenRequest {
  reason: string;
}

/** Public API consumed by the HTTP route. */
export interface ReopenApi {
  /** Reopen a submitted version into a new editable REOPENED draft. */
  reopen(versionId: string, request: ReopenRequest): Promise<UpdateDocument>;
}

export class ReopenService implements ReopenApi {
  private readonly repository: ReopenRepositoryPort;
  private readonly auth: AuthContext;

  constructor(repository: ReopenRepositoryPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async reopen(versionId: string, request: ReopenRequest): Promise<UpdateDocument> {
    // R11.4 / R2.3 — a mandatory, non-empty reason. A whitespace-only reason
    // still passes the route's minLength schema, so it is trimmed and rejected
    // here. A rejected reason changes nothing.
    const reason = request.reason?.trim() ?? '';
    if (reason.length === 0) {
      throw ApiError.validation('A reason is required to reopen a submitted update.', [
        { path: 'reason', message: 'Enter why this submitted update is being reopened.' },
      ]);
    }

    // Resolve the immutable submitted version being reopened.
    const version = await this.repository.getVersion(versionId);
    if (!version) {
      throw ApiError.notFound(`Submitted version "${versionId}" was not found.`);
    }

    // R1.4 — the authorised-role gate is enforced server-side. Only an assigned
    // Team Lead may reopen a submitted update (requirements.md R1 role matrix).
    const user = this.auth.getCurrentUser();
    const isAssigned = user.assignedTeamIds.includes(version.teamId);
    const isTeamLead = user.roles.includes('TEAM_LEAD');
    if (!isAssigned || !isTeamLead) {
      throw new ApiError(
        'PERMISSION_DENIED',
        'Only an assigned Team Lead can reopen a submitted update.',
      );
    }

    const id = docKey(version.teamId, version.sprintId, version.checkpointId);
    const existing = await this.repository.getDraft(id);

    // Lifecycle guards (state machine §5). A reopen is only valid against the
    // CURRENT submitted version of the update aggregate. Each guard below is a
    // 409 INVALID_STATE and — because it throws before any write — leaves the
    // revision, content, versions and audit trail completely unchanged.

    // 1. The aggregate must exist and currently be SUBMITTED. This rejects
    //    reopening a MISSING or DRAFT aggregate, and rejects a SECOND reopen
    //    while the aggregate is already REOPENED.
    if (!existing) {
      throw ApiError.invalidState(
        'This update cannot be reopened because it has no submitted version to reopen.',
      );
    }
    if (existing.state !== 'SUBMITTED') {
      const detail =
        existing.state === 'REOPENED'
          ? 'It is already open for editing.'
          : 'Only a submitted update can be reopened.';
      throw ApiError.invalidState(`This update cannot be reopened. ${detail}`);
    }

    // 2. Only the LATEST submitted version may be reopened. Reopening an older
    //    version after a newer submission exists is rejected, so a stale link
    //    can never resurrect superseded content over current evidence.
    const versions = await this.repository.listVersions(version.teamId, version.checkpointId);
    const latest = versions[0];
    if (!latest || latest.id !== version.id) {
      throw ApiError.invalidState(
        'This is not the latest submitted version. Reopen the current version instead.',
      );
    }

    const now = new Date().toISOString();

    // The stored revision is authoritative; the adapter sets the new revision to
    // expectedRevision + 1 under the optimistic-concurrency guard (task 7.4).
    const expectedRevision = existing.revision;
    const nextRevision = expectedRevision + 1;

    // A NEW editable draft in the REOPENED state, seeded from the latest
    // submitted version's content. The submitted version itself is untouched.
    const document: Omit<UpdateDocument, 'revision'> = {
      id,
      programmeId: version.programmeId,
      streamId: version.streamId,
      teamId: version.teamId,
      sprintId: version.sprintId,
      checkpointId: version.checkpointId,
      state: 'REOPENED',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: version.rag,
      hasBlocker: version.hasBlocker,
      hasLeadershipAsk: version.hasLeadershipAsk,
      createdAt: existing.createdAt,
      updatedAt: now,
      updatedBy: user.subject,
      // Keep the last submission timestamp visible on the reopened envelope.
      submittedAt: version.submittedAt,
      payload: version.payload,
    };

    // R11.4 / R14.2 — append-only audit record: actor, timestamp, action, entity
    // id, previous version (the submitted version number), new version (the new
    // draft revision) and the mandatory reason.
    const audit: AuditEvent = {
      id: randomUUID(),
      programmeId: version.programmeId,
      // Shared update-aggregate key so this reopen joins the same unified audit
      // history as the submit/resubmit/decision events for this update.
      aggregateId: id,
      entityType: 'UPDATE',
      entityId: id,
      action: 'REOPENED',
      actorSubject: user.subject,
      timestamp: now,
      previousVersion: version.versionNumber,
      newVersion: nextRevision,
      reason,
      correlationId: randomUUID(),
    };

    const outcome = await this.repository.reopenUpdate({
      document,
      audit,
      expectedRevision,
    });

    if (!outcome.ok) {
      // A concurrent edit/reopen advanced the draft: surface the server's
      // current metadata and change nothing.
      throw new DraftRevisionConflictError(outcome.server);
    }
    return outcome.document;
  }
}
