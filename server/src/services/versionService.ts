/**
 * Version history and field-level comparison service (task 7.8).
 *
 * The vendor-neutral business layer behind the §6 history/audit read endpoints:
 *   GET /api/v1/teams/{teamId}/updates/{checkpointId}/versions  — version list
 *   GET /api/v1/updates/{versionId}                             — a single version
 *   GET /api/v1/updates/{versionId}/audit                       — audit trail
 *   GET /api/v1/updates/{versionId}/compare/{compareVersionId}  — field diff
 *
 * It surfaces the append-only history the store already retains (every
 * submitted version, reopen event and leadership decision — R14.1) and, for
 * R14.3, produces the structured field-by-field diff between two immutable
 * versions. Reads never mutate history and the diff is a derived read model,
 * so evidence stays immutable and audit data append-only (R14.1, R14.4).
 *
 * Like the other read services it depends only on a narrow repository *port*
 * and the mocked auth context — never on MongoDB (design.md §4b vendor-neutral
 * boundary). Authentication is mocked for the PoC; team-scoped authorisation is
 * Phase 8 (task 8.3), so this service does not yet enforce role/assignment
 * scoping on reads — consistent with the hierarchy and leadership read
 * services.
 */
import { docKey, type AuditEvent, type UpdateVersion } from '../domain/documents.js';
import type { ReportingCheckpoint, Team } from '../domain/hierarchy.js';
import { ApiError } from '../http/errorEnvelope.js';
import { compareVersions, type VersionComparison } from '../domain/versionComparison.js';

/**
 * The narrow slice of the repository this service needs. Declaring it here (not
 * importing the full {@link DocumentRepository}) keeps the service decoupled
 * from write/append concerns and trivially fakeable in unit tests.
 */
export interface VersionReadPort {
  getTeam(teamId: string): Promise<Team | null>;
  getCheckpoint(checkpointId: string): Promise<ReportingCheckpoint | null>;
  listVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;
  getVersion(id: string): Promise<UpdateVersion | null>;
  /** The complete unified audit trail for an update aggregate, newest first. */
  listAuditForAggregate(aggregateId: string): Promise<AuditEvent[]>;
}

/** Public API consumed by the HTTP routes. */
export interface VersionApi {
  /** List a team + checkpoint's immutable submitted versions, newest first. */
  getVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]>;
  /** Read a single immutable submitted version by id. */
  getVersion(versionId: string): Promise<UpdateVersion>;
  /**
   * The COMPLETE audit trail for the update a version belongs to, newest first.
   * Resolves the version id first, so an unknown version is a 404 (never an
   * empty 200). Returns submit, reopen, resubmit and leadership-decision events
   * as one unified history (design.md §6 / OpenAPI).
   */
  getAudit(versionId: string): Promise<AuditEvent[]>;
  /** Compare two versions field by field, producing a structured diff (R14.3). */
  compareVersions(
    versionId: string,
    compareVersionId: string,
  ): Promise<VersionComparison>;
}

export class VersionService implements VersionApi {
  private readonly repository: VersionReadPort;

  constructor(repository: VersionReadPort) {
    this.repository = repository;
  }

  async getVersions(teamId: string, checkpointId: string): Promise<UpdateVersion[]> {
    // Validate the path so an unknown team/checkpoint is a 404 rather than a
    // silently empty list (mirrors the draft read endpoint).
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
    return this.repository.listVersions(teamId, checkpointId);
  }

  async getVersion(versionId: string): Promise<UpdateVersion> {
    const version = await this.repository.getVersion(versionId);
    if (!version) {
      throw ApiError.notFound(`Submitted version "${versionId}" was not found.`);
    }
    return version;
  }

  async getAudit(versionId: string): Promise<AuditEvent[]> {
    // Resolve the version FIRST so an unknown id is a 404 NOT_FOUND rather than
    // a misleading empty 200 (OpenAPI documents 404 for this path).
    const version = await this.repository.getVersion(versionId);
    if (!version) {
      throw ApiError.notFound(`Submitted version "${versionId}" was not found.`);
    }
    // Return the whole update's history (submit + reopen + resubmit + decision),
    // newest first, keyed by the stable update-aggregate id.
    const aggregateId = docKey(version.teamId, version.sprintId, version.checkpointId);
    return this.repository.listAuditForAggregate(aggregateId);
  }

  async compareVersions(
    versionId: string,
    compareVersionId: string,
  ): Promise<VersionComparison> {
    // Comparing a version with itself is a misuse — there is nothing to diff.
    if (versionId === compareVersionId) {
      throw ApiError.validation('Choose two different versions to compare.', [
        { path: 'compareVersionId', message: 'Must differ from the base version.' },
      ]);
    }

    // Resolve both immutable versions. An unknown id on either side is a 404.
    const [base, other] = await Promise.all([
      this.repository.getVersion(versionId),
      this.repository.getVersion(compareVersionId),
    ]);
    if (!base) {
      throw ApiError.notFound(`Submitted version "${versionId}" was not found.`);
    }
    if (!other) {
      throw ApiError.notFound(`Submitted version "${compareVersionId}" was not found.`);
    }

    // A field-by-field diff is only meaningful within a single update line (the
    // same team + sprint + checkpoint). Comparing versions from different teams
    // or checkpoints is invalid — reject it rather than emitting a meaningless
    // diff (R14.3).
    if (
      base.teamId !== other.teamId ||
      base.sprintId !== other.sprintId ||
      base.checkpointId !== other.checkpointId
    ) {
      throw ApiError.validation(
        'Versions can only be compared within the same team, sprint and checkpoint.',
        [
          {
            path: 'compareVersionId',
            message: 'Must belong to the same team, sprint and checkpoint as the base version.',
          },
        ],
      );
    }

    return compareVersions(base, other);
  }
}
