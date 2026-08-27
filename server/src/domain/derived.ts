/**
 * Derived quality metrics for the PoC backend.
 *
 * These values are ALWAYS calculated from the submitted counts and are never
 * stored as independently editable truth (R6.4, design.md §4). The shape and
 * rounding MIRROR the frontend domain helper (`src/domain/derived.ts`) so a
 * rate computed here is identical to what the UI already shows. Used by the
 * export projection (task 7.10) so an exported snapshot carries the same
 * execution / pass rates leadership sees on screen (R16.2).
 */
import type { QualityEvidence } from './documents.js';

export interface DerivedRates {
  /** executed / planned, 0..100, or null when planned is 0. */
  executionRate: number | null;
  /** passed / executed, 0..100, or null when executed is 0. */
  passRate: number | null;
}

/** Calculate the derived execution / pass rates from the raw counts. */
export function calculateDerivedRates(metrics: QualityEvidence): DerivedRates {
  const executionRate =
    metrics.planned > 0 ? round1((metrics.executed / metrics.planned) * 100) : null;
  const passRate =
    metrics.executed > 0 ? round1((metrics.passed / metrics.executed) * 100) : null;
  return { executionRate, passRate };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
