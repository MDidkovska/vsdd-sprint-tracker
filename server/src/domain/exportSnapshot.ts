/**
 * Structured export shapes for the PoC backend (task 7.10).
 *
 * The export is a flattened, self-contained JSON view of the SAME filtered
 * Leadership View population (task 7.7). It reuses the leadership projection so
 * the exported records always match the on-screen filtered snapshot exactly
 * (design.md §13 export scoping; requirements.md R16). These types mirror the
 * OpenAPI `ExportRequest` / `ExportSnapshot` component schemas.
 *
 * R16.2 — every record carries the reporting-period context (top level) plus,
 * per team: version timestamps, the three RAG labels, the four goals, the
 * quality evidence and its derived rates, the AI value fields, the exceptions
 * and the leadership ask (the last five live in `payload`).
 *
 * R16.3 — Draft / Missing / Stale updates are marked visibly: `state` carries
 * the presentation state and `isSubmittedEvidence` is false for anything that
 * is not a current submitted version, so a stale or draft row can never read as
 * current leadership evidence.
 */
import type { RagStatuses, UpdatePayload } from './documents.js';
import type { DerivedRates } from './derived.js';
import type { LeadershipCellState, LeadershipFilters } from './leadership.js';

/** The export request contract (OpenAPI `ExportRequest`). */
export interface ExportRequest {
  sprintId: string;
  checkpointId: string;
  filters: LeadershipFilters;
}

/**
 * One flattened team row in the export. `rag` / `payload` / `derivedRates` are
 * null for a Missing cell (no evidence — never a false Green, R12.4).
 */
export interface ExportRecord {
  teamId: string;
  teamName: string;
  streamId: string;
  streamName: string;
  /** Presentation state — marks DRAFT / MISSING / STALE visibly (R16.3). */
  state: LeadershipCellState;
  /** False for anything that is not a current submitted version (R16.3). */
  isSubmittedEvidence: boolean;
  /** True when the content is carried over from an earlier checkpoint. */
  isStale: boolean;
  /** null for a Missing cell — never a false Green. */
  rag: RagStatuses | null;
  /** null only for a Missing cell (nothing exists at all). */
  payload: UpdatePayload | null;
  /** Execution / pass rates derived from the payload's quality evidence. */
  derivedRates: DerivedRates | null;
  /** Checkpoint the displayed content actually came from (Stale labelling). */
  sourceCheckpointId: string | null;
  sourceWeekNumber: 1 | 2 | null;
  /** Version timestamps (R16.2). null when absent for the resolved content. */
  submittedAt: string | null;
  updatedAt: string | null;
}

/**
 * The export snapshot response envelope (OpenAPI `ExportSnapshot`): the
 * reporting-period context, the applied filter context, the record count, the
 * generation timestamp and the flattened per-team records.
 */
export interface ExportSnapshot {
  programme: string;
  sprintId: string;
  checkpointId: string;
  reportingPeriodLabel: string;
  filters: LeadershipFilters;
  recordCount: number;
  exportedAt: string;
  records: ExportRecord[];
}
