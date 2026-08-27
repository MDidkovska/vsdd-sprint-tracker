/**
 * Structured leadership export service (task 7.10).
 *
 * The vendor-neutral business layer behind the export endpoint (design.md §6):
 *   POST /api/v1/programmes/{programmeId}/exports
 *
 * For the local PoC this is a SYNCHRONOUS structured JSON snapshot returned in
 * the response body — the agreed export format (requirements.md R16.1, task
 * 0.2). Asynchronous export jobs and download-artifact storage are deliberately
 * NOT implemented here; they are deferred to a future production decision and
 * are not required by R16.
 *
 * The export produces a self-contained JSON snapshot of the SAME filtered
 * Leadership View population (requirements.md R16). Rather than re-deriving the
 * projection, it delegates to the leadership reporting-summary service built in
 * task 7.7 and flattens the resulting filtered tree — so the exported records
 * always match the on-screen filtered snapshot exactly (design.md §13 export
 * scoping; the filtered export must match the visible population).
 *
 * Every SUCCESSFUL export appends an append-only `EXPORT_CREATED` security-audit
 * event (R15). A denied or failed export never writes a success event.
 *
 * Each record carries the reporting-period context (top level) plus, per team:
 * version timestamps, the three RAG labels, the four goals, the quality
 * evidence and its derived rates, the AI value fields, the exceptions and the
 * leadership ask (R16.2). Draft / Missing / Stale rows are marked visibly via
 * `state` + `isSubmittedEvidence` so they can never read as current submitted
 * evidence (R16.3).
 *
 * Authorisation (R16.4, design.md §13): export access follows the same
 * programme permissions as the UI. Authentication is mocked for the local PoC
 * (Phase 8 handles real OIDC), but the programme-permission gate is enforced
 * here on the server — only a subject with Programme Leadership access to the
 * whole programme may export. The gate is checked BEFORE any programme lookup,
 * so an unauthorised caller gets the same PERMISSION_DENIED whether or not the
 * programme exists — closing the programme-data enumeration side channel.
 */
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../auth/mockAuth.js';
import { calculateDerivedRates } from '../domain/derived.js';
import type { AuditEvent } from '../domain/documents.js';
import type {
  ExportRecord,
  ExportRequest,
  ExportSnapshot,
} from '../domain/exportSnapshot.js';
import type { LeadershipFilters, ResolvedUpdate } from '../domain/leadership.js';
import { ApiError } from '../http/errorEnvelope.js';
import type { ReportingSummaryQuery, SummaryApi } from './summaryService.js';

/** Public API consumed by the HTTP route. */
export interface ExportApi {
  /** Create a structured export of the filtered leadership snapshot. */
  createExport(programmeId: string, request: ExportRequest): Promise<ExportSnapshot>;
}

/**
 * The narrow slice of the repository the export needs: an append-only audit
 * sink. Declaring it here keeps the service decoupled and trivially fakeable.
 */
export interface ExportAuditPort {
  appendAudit(event: AuditEvent): Promise<AuditEvent>;
}

export class ExportService implements ExportApi {
  private readonly summaries: SummaryApi;
  private readonly auth: AuthContext;
  private readonly audit: ExportAuditPort;

  /**
   * Reuses the leadership reporting-summary projection (task 7.7) so the export
   * and the on-screen Leadership View share one filtering implementation, and
   * writes an append-only security-audit event for every SUCCESSFUL export
   * (requirements.md R15 — reopen and export are security-relevant events).
   */
  constructor(summaries: SummaryApi, auth: AuthContext, audit: ExportAuditPort) {
    this.summaries = summaries;
    this.auth = auth;
    this.audit = audit;
  }

  async createExport(
    programmeId: string,
    request: ExportRequest,
  ): Promise<ExportSnapshot> {
    // R16.4 / design.md §13 — authorise FIRST, before any programme lookup, so
    // an unauthorised caller cannot enumerate which programmes exist by
    // comparing PERMISSION_DENIED vs NOT_FOUND. Export follows the same
    // programme permission as the UI: Programme Leadership with whole-programme
    // visibility (mirrors the frontend `canViewAll` leadership gate).
    const user = this.auth.getCurrentUser();
    const canExport = user.roles.includes('LEADERSHIP') && user.canViewAll;
    if (!canExport) {
      throw new ApiError(
        'PERMISSION_DENIED',
        'You do not have permission to export this programme.',
      );
    }

    const filters: LeadershipFilters = request.filters;

    // Delegate to the leadership projection. It resolves + validates the
    // reporting cycle (400 on a missing sprint/checkpoint, 404 on an unknown
    // programme/cycle) and applies the identical stream / RAG / state filters,
    // so the export population is exactly the filtered on-screen population.
    const query: ReportingSummaryQuery = {
      sprintId: request.sprintId,
      checkpointId: request.checkpointId,
      streamId: filters?.streamId,
      rag: filters?.rag,
      state: filters?.state,
    };
    const summary = await this.summaries.getReportingSummary(programmeId, query);

    // Flatten the filtered Programme -> Stream -> Team tree into export records.
    const records: ExportRecord[] = summary.snapshot.streams.flatMap((group) =>
      group.teams.map((cell) => toExportRecord(cell.team, group.stream, cell.resolved)),
    );

    const exportedAt = new Date().toISOString();
    const correlationId = randomUUID();

    // R15 — record a security-relevant audit event for every SUCCESSFUL export.
    // This runs only after authorisation passed and the (validated) snapshot was
    // produced, so an unauthorised or failed export never writes a success
    // event. Only stable ids and the non-sensitive filter selection are stored;
    // NO user-authored update content is written to the audit trail.
    const appliedFilters = summary.filters;
    const auditEvent: AuditEvent = {
      id: randomUUID(),
      programmeId,
      // Export is not tied to a single update aggregate; scope it to the
      // programme (never collides with a real `team|sprint|checkpoint` key).
      aggregateId: programmeId,
      entityType: 'EXPORT',
      entityId: programmeId,
      action: 'EXPORT_CREATED',
      actorSubject: user.subject,
      timestamp: exportedAt,
      filterSummary:
        `sprint=${request.sprintId}; checkpoint=${request.checkpointId}; ` +
        `stream=${appliedFilters.streamId}; rag=${appliedFilters.rag}; ` +
        `state=${appliedFilters.state}; records=${records.length}`,
      correlationId,
    };
    await this.audit.appendAudit(auditEvent);

    return {
      programme: summary.snapshot.programme.name,
      sprintId: summary.snapshot.sprint.id,
      checkpointId: summary.snapshot.checkpoint.id,
      reportingPeriodLabel: summary.summary.reportingPeriodLabel,
      filters: appliedFilters,
      recordCount: records.length,
      exportedAt,
      records,
    };
  }
}

/** Flatten one resolved leadership cell into a self-contained export record. */
function toExportRecord(
  team: { id: string; name: string },
  stream: { id: string; name: string },
  resolved: ResolvedUpdate,
): ExportRecord {
  return {
    teamId: team.id,
    teamName: team.name,
    streamId: stream.id,
    streamName: stream.name,
    state: resolved.cellState,
    isSubmittedEvidence: resolved.isSubmittedEvidence,
    isStale: resolved.isStale,
    rag: resolved.rag,
    payload: resolved.payload,
    // Derived rates travel with the record so the export is self-contained
    // (R16.2). Null for a Missing cell, which has no quality evidence.
    derivedRates: resolved.payload
      ? calculateDerivedRates(resolved.payload.qualityEvidence)
      : null,
    sourceCheckpointId: resolved.sourceCheckpointId,
    sourceWeekNumber: resolved.sourceWeekNumber,
    submittedAt: resolved.submittedAt ?? null,
    updatedAt: resolved.updatedAt ?? null,
  };
}
