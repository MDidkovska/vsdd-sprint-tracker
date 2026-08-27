import { describe, expect, it } from 'vitest';
import {
  calculateDerivedRates,
  findMetricInconsistencies,
  formatRate,
} from './derived';
import type { QualityEvidence } from './update';

function metrics(overrides: Partial<QualityEvidence> = {}): QualityEvidence {
  return {
    planned: 120,
    executed: 84,
    passed: 79,
    openCritical: 1,
    blocked: 5,
    automationPercent: 18,
    ...overrides,
  };
}

describe('calculateDerivedRates', () => {
  it('computes execution and pass rates', () => {
    const rates = calculateDerivedRates(metrics());
    expect(rates.executionRate).toBe(70);
    expect(rates.passRate).toBe(94);
  });

  it('returns null execution rate when nothing is planned', () => {
    expect(calculateDerivedRates(metrics({ planned: 0, executed: 0 })).executionRate).toBeNull();
  });

  it('returns null pass rate when nothing is executed', () => {
    expect(calculateDerivedRates(metrics({ executed: 0, passed: 0 })).passRate).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(calculateDerivedRates(metrics({ planned: 3, executed: 1 })).executionRate).toBe(33.3);
  });
});

describe('findMetricInconsistencies', () => {
  it('flags passed greater than executed', () => {
    expect(findMetricInconsistencies(metrics({ passed: 90, executed: 84 }))).toContain(
      'PASSED_GT_EXECUTED',
    );
  });

  it('flags executed greater than planned', () => {
    expect(findMetricInconsistencies(metrics({ executed: 130 }))).toContain('EXECUTED_GT_PLANNED');
  });

  it('reports no issues for a consistent set', () => {
    expect(findMetricInconsistencies(metrics())).toHaveLength(0);
  });
});

describe('formatRate', () => {
  it('renders a dash for null', () => {
    expect(formatRate(null)).toBe('—');
  });
  it('renders a percentage', () => {
    expect(formatRate(70)).toBe('70%');
  });
});
