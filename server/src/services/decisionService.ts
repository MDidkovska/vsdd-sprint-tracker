/**
 * Leadership decision service (task 7.9).
 *
 * The vendor-neutral business layer behind the leadership decision endpoints
 * (design.md §6):
 *   POST /api/v1/updates/{versionId}/decisions
 *   GET  /api/v1/updates/{versionId}/decisions
 *
 * Recording a decision against a leadership ask (R10.3):
 *   1. requires a mandatory, non-empty decision — a missing/whitespace-only
 *      decision is a 400 VALIDATION_FAILED and creates nothing;
 *   2. resolves the immutable {@link UpdateVersion} by id — an unknown version is
 *      a 404 NOT_FOUND;
 *   3. is gated on an authorised role: only Programme Leadership may record a
 *      decision (requirements.md R1 role matrix). An unauthorised caller is a
 *      403 PERMISSION_DENIED;
 *   4. appends a NEW immutable {@link LeadershipDecision} document plus an
 *      append-only {@link AuditEvent} (action DECISION_RECORDED) atomically —
 *      WITHOUT editing the referenced version or the team's original leadership
 *      ask (R10.3, R14.1, R14.2, R14.4).
 *
 * The referenced {@link UpdateVersion} is NEVER mutated or deleted — the
 * decision is a separate append-only record. The decision append and the audit
 * append happen atomically through the repository's `recordDecision` operation.
 *
 * Like the submit/reopen services, this depends only on a narrow repository
 * *port* and the mocked auth context — never on MongoDB (design.md §4b).
 * Authentication is mocked for the PoC (Phase 8 handles real OIDC), but the
 * authorised-role gate is enforced here on the server.
 */
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../auth/mockAuth.js';
import {
  docKey,
  type AuditEvent,
  type LeadershipDecision,
  type UpdateVersion,
} from '../domain/documents.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { RecordDecisionInput } from '../repository/documentRepository.js';

/**
 * The narrow slice of the repository the decision flow needs. Declaring it here
 * keeps the service decoupled and trivially fakeable in unit tests.
 */
export interface DecisionRepositoryPort {
  getVersion(id: string): Promise<UpdateVersion | null>;
  recordDecision(input: RecordDecisionInput): Promise<LeadershipDecision>;
  listDecisions(versionId: string): Promise<LeadershipDecision[]>;
}

/** The decision request contract (design.md §6 / OpenAPI DecisionRequest). */
export interface DecisionRequest {
  decision: string;
  dueDate?: string;
}

/** Public API consumed by the HTTP routes. */
export interface DecisionApi {
  /** Record a leadership decision against a submitted version. */
  recordDecision(
    versionId: string,
    request: DecisionRequest,
  ): Promise<LeadershipDecision>;
  /** List the decisions recorded against a submitted version, oldest first. */
  getDecisions(versionId: string): Promise<LeadershipDecision[]>;
}

export class DecisionService implements DecisionApi {
  private readonly repository: DecisionRepositoryPort;
  private readonly auth: AuthContext;

  constructor(repository: DecisionRepositoryPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async recordDecision(
    versionId: string,
    request: DecisionRequest,
  ): Promise<LeadershipDecision> {
    // R10.3 — a mandatory, non-empty decision. A whitespace-only decision still
    // passes the route's minLength schema, so it is trimmed and rejected here.
    // A rejected decision changes nothing.
    const decisionText = request.decision?.trim() ?? '';
    if (decisionText.length === 0) {
      throw ApiError.validation('A decision is required.', [
        { path: 'decision', message: 'Enter the decision to record against this ask.' },
      ]);
    }

    // Resolve the immutable submitted version the decision is recorded against.
    const version = await this.repository.getVersion(versionId);
    if (!version) {
      throw ApiError.notFound(`Submitted version "${versionId}" was not found.`);
    }

    // R1 role matrix — the authorised-role gate is enforced server-side. Only
    // Programme Leadership may record a decision (mirrors the frontend mock).
    const user = this.auth.getCurrentUser();
    if (!user.roles.includes('LEADERSHIP')) {
      throw new ApiError(
        'PERMISSION_DENIED',
        'Only Programme Leadership can record a decision.',
      );
    }

    const now = new Date().toISOString();

    // A NEW append-only decision document referencing the submitted version.
    // The version and the team's original ask are left completely untouched.
    // `dueDate` is optional (OpenAPI DecisionRequest): only include it when
    // supplied so the stored/returned document omits the field rather than
    // carrying a null (which `additionalProperties: false` would reject).
    const dueDate = request.dueDate?.trim();
    const decision: LeadershipDecision = {
      id: randomUUID(),
      updateVersionId: versionId,
      decision: decisionText,
      ownerSubject: user.subject,
      ...(dueDate ? { dueDate } : {}),
      status: 'OPEN',
      createdAt: now,
    };

    // R14.2/R14.4 — append-only audit record: actor, timestamp, action and the
    // decision entity id. A decision does not version an update, so previous/
    // new version are intentionally absent.
    const audit: AuditEvent = {
      id: randomUUID(),
      programmeId: version.programmeId,
      // Shared update-aggregate key so the decision joins the same unified audit
      // history as the submit/reopen events for the update it concerns.
      aggregateId: docKey(version.teamId, version.sprintId, version.checkpointId),
      entityType: 'DECISION',
      entityId: decision.id,
      action: 'DECISION_RECORDED',
      actorSubject: user.subject,
      timestamp: now,
      correlationId: randomUUID(),
    };

    return this.repository.recordDecision({ decision, audit });
  }

  async getDecisions(versionId: string): Promise<LeadershipDecision[]> {
    // Resolve the version so an unknown id is a 404 rather than an empty list.
    const version = await this.repository.getVersion(versionId);
    if (!version) {
      throw ApiError.notFound(`Submitted version "${versionId}" was not found.`);
    }
    return this.repository.listDecisions(versionId);
  }
}
