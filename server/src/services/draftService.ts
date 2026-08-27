/**
 * Team-draft read/write service (task 7.4).
 *
 * The vendor-neutral business layer behind the draft endpoints (design.md §6):
 *   GET /api/v1/teams/{teamId}/updates/{checkpointId}   — read the current draft
 *   PUT /api/v1/teams/{teamId}/drafts/{checkpointId}     — save with a revision
 *
 * It depends only on the repository *contract* (a narrow read/write port) and
 * the mocked auth context — never on MongoDB (design.md §4b vendor-neutral
 * boundary). Optimistic concurrency uses the `revision` field as an ETag: a
 * write carries the revision the client last read, the store rejects a stale
 * write (409 DRAFT_REVISION_CONFLICT) and overwrites nothing (R11.5). On a
 * successful write the revision is incremented and the new `revision`,
 * `updatedAt` and `updatedBy` are returned.
 *
 * Authentication remains mocked for the PoC; team-scoped authorisation is
 * Phase 8 (task 8.3), so this service does not yet enforce role/assignment
 * scoping. It resolves `updatedBy` from the mocked subject.
 */
import type { AuthContext } from '../auth/mockAuth.js';
import {
  CURRENT_SCHEMA_VERSION,
  deriveEnvelopeFlags,
  docKey,
  type AiValue,
  type ExceptionItem,
  type GoalsAndCommitments,
  type QualityEvidence,
  type RagStatuses,
  type UpdateDocument,
  type UpdatePayload,
  type UpdateState,
} from '../domain/documents.js';
import type {
  ReportingCheckpoint,
  Sprint,
  Team,
} from '../domain/hierarchy.js';
import { ApiError, DraftRevisionConflictError } from '../http/errorEnvelope.js';
import type { SaveDraftInput, WriteOutcome } from '../repository/documentRepository.js';

/**
 * The narrow slice of the repository this service needs. Declaring it here (not
 * importing the full {@link DocumentRepository}) keeps the service decoupled
 * and trivially fakeable in unit tests.
 */
export interface DraftRepositoryPort {
  getTeam(teamId: string): Promise<Team | null>;
  getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null>;
  getSprint(sprintId: string): Promise<Sprint | null>;
  getDraft(id: string): Promise<UpdateDocument | null>;
  saveDraft(input: SaveDraftInput): Promise<WriteOutcome<UpdateDocument>>;
}

/**
 * The draft update contract carried by every PUT (design.md §6 /
 * OpenAPI DraftUpdateRequest). Structurally identical to the frontend
 * `SaveDraftInput` payload so a document written here round-trips through the
 * same repository contract the Phase A mock implements.
 */
export interface DraftUpdateRequest {
  revision: number;
  rag: RagStatuses;
  goals: GoalsAndCommitments;
  qualityEvidence: QualityEvidence;
  achievements: string;
  aiValue: AiValue;
  exceptions: ExceptionItem[];
  leadershipAsk: string;
  statusRationale?: string;
  metricsNote?: string;
}

/** Public API consumed by the HTTP routes. */
export interface DraftApi {
  /** Read the current draft/update for a team + checkpoint. */
  getUpdate(teamId: string, checkpointId: string): Promise<UpdateDocument>;
  /** Save the mutable draft under the optimistic-concurrency revision guard. */
  saveDraft(
    teamId: string,
    checkpointId: string,
    request: DraftUpdateRequest,
  ): Promise<UpdateDocument>;
}

/** Context resolved from the path + reference data for a draft operation. */
interface DraftContext {
  team: Team;
  checkpoint: ReportingCheckpoint;
  sprint: Sprint;
}

export class DraftService implements DraftApi {
  private readonly repository: DraftRepositoryPort;
  private readonly auth: AuthContext;

  constructor(repository: DraftRepositoryPort, auth: AuthContext) {
    this.repository = repository;
    this.auth = auth;
  }

  async getUpdate(teamId: string, checkpointId: string): Promise<UpdateDocument> {
    const context = await this.resolveContext(teamId, checkpointId);
    const id = docKey(teamId, context.sprint.id, checkpointId);

    const existing = await this.repository.getDraft(id);
    if (existing) return existing;

    // No draft or submission exists for this checkpoint -> a MISSING document.
    // Mirrors the frontend mock so both sides present one identical contract.
    return this.missingDocument(context, id);
  }

  async saveDraft(
    teamId: string,
    checkpointId: string,
    request: DraftUpdateRequest,
  ): Promise<UpdateDocument> {
    const context = await this.resolveContext(teamId, checkpointId);
    const id = docKey(teamId, context.sprint.id, checkpointId);
    const subject = this.auth.getCurrentUser().subject;

    const existing = await this.repository.getDraft(id);

    // A submitted update is immutable until reopened (state-machine guard).
    if (existing?.state === 'SUBMITTED') {
      throw new ApiError(
        'ALREADY_SUBMITTED',
        'This update is submitted and immutable. Reopen it before editing or resubmitting.',
      );
    }

    const payload = buildPayload(request);
    const flags = deriveEnvelopeFlags(payload);
    const now = new Date().toISOString();
    // A reopened draft keeps REOPENED; otherwise editing makes it a DRAFT.
    const nextState: UpdateState = existing?.state === 'REOPENED' ? 'REOPENED' : 'DRAFT';

    // The stored revision is authoritative; the adapter sets it to
    // expectedRevision + 1. We never trust the revision inside the body.
    const document: Omit<UpdateDocument, 'revision'> = {
      id,
      programmeId: context.sprint.programmeId,
      streamId: context.team.streamId,
      teamId,
      sprintId: context.sprint.id,
      checkpointId,
      state: nextState,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: request.rag,
      hasBlocker: flags.hasBlocker,
      hasLeadershipAsk: flags.hasLeadershipAsk,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: subject,
      submittedAt: existing?.submittedAt,
      payload,
    };

    const outcome = await this.repository.saveDraft({
      document,
      expectedRevision: request.revision,
    });

    if (!outcome.ok) {
      // Stale revision: surface the server's current metadata; overwrite nothing.
      throw new DraftRevisionConflictError(outcome.server);
    }
    return outcome.document;
  }

  /**
   * Resolve and validate the team, checkpoint and owning sprint from the path.
   * A missing team or checkpoint is a 404 with the §6 envelope.
   */
  private async resolveContext(
    teamId: string,
    checkpointId: string,
  ): Promise<DraftContext> {
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

  /** Build the MISSING placeholder document returned when no draft exists. */
  private missingDocument(context: DraftContext, id: string): UpdateDocument {
    const now = new Date().toISOString();
    return {
      id,
      programmeId: context.sprint.programmeId,
      streamId: context.team.streamId,
      teamId: context.team.id,
      sprintId: context.sprint.id,
      checkpointId: context.checkpoint.id,
      state: 'MISSING',
      revision: 0,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
      hasBlocker: false,
      hasLeadershipAsk: false,
      createdAt: now,
      updatedAt: now,
      updatedBy: this.auth.getCurrentUser().subject,
      payload: emptyPayload(),
    };
  }
}

/** Assemble the flexible payload from the draft request (design.md §4a). */
export function buildPayload(request: DraftUpdateRequest): UpdatePayload {
  return {
    goals: request.goals,
    qualityEvidence: request.qualityEvidence,
    achievements: request.achievements,
    aiValue: request.aiValue,
    exceptions: request.exceptions,
    leadershipAsk: request.leadershipAsk,
    statusRationale: request.statusRationale ?? '',
    metricsNote: request.metricsNote ?? '',
  };
}

/** An empty payload for a MISSING document (mirrors the frontend mock). */
function emptyPayload(): UpdatePayload {
  return {
    goals: { business: '', technicalTesting: '', sprintCommitment: '', nextWeekCommitment: '' },
    qualityEvidence: {
      planned: 0,
      executed: 0,
      passed: 0,
      openCritical: 0,
      blocked: 0,
      automationPercent: 0,
    },
    achievements: '',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: '',
    statusRationale: '',
    metricsNote: '',
  };
}
