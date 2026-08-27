/**
 * Derived quality metrics. These values are ALWAYS calculated from submitted
 * counts and are never stored as independently editable truth (R6.4, design §4).
 */
import type { QualityEvidence } from './update';

export interface DerivedRates {
  /** executed / planned, 0..100, or null when planned is 0. */
  executionRate: number | null;
  /** passed / executed, 0..100, or null when executed is 0. */
  passRate: number | null;
}

export function calculateDerivedRates(metrics: QualityEvidence): DerivedRates {
  const executionRate =
    metrics.planned > 0 ? round1((metrics.executed / metrics.planned) * 100) : null;
  const passRate =
    metrics.executed > 0 ? round1((metrics.passed / metrics.executed) * 100) : null;
  return { executionRate, passRate };
}

export type MetricInconsistency = 'PASSED_GT_EXECUTED' | 'EXECUTED_GT_PLANNED';

export const METRIC_INCONSISTENCY_MESSAGES: Record<MetricInconsistency, string> = {
  PASSED_GT_EXECUTED: 'Passed tests exceed executed tests.',
  EXECUTED_GT_PLANNED: 'Executed tests exceed planned tests.',
};

/** Non-blocking warnings; submission is allowed only with an explanation (R6.3). */
export function findMetricInconsistencies(metrics: QualityEvidence): MetricInconsistency[] {
  const issues: MetricInconsistency[] = [];
  if (metrics.passed > metrics.executed) issues.push('PASSED_GT_EXECUTED');
  if (metrics.executed > metrics.planned) issues.push('EXECUTED_GT_PLANNED');
  return issues;
}

export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
