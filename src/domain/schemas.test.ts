import { describe, expect, it } from 'vitest';
import {
  GOAL_MAX_LENGTH,
  GOAL_MIN_CAPACITY,
  deriveEnvelopeFlags,
  validateSubmission,
  type TeamUpdateFormValues,
} from './schemas';
import type { UpdatePayload } from './update';

function validValues(overrides: Partial<TeamUpdateFormValues> = {}): TeamUpdateFormValues {
  return {
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    goals: {
      business: 'Enable the September release.',
      technicalTesting: 'Close critical regression gaps.',
      sprintCommitment: 'Execute committed tests and raise release evidence.',
      nextWeekCommitment: 'Retest fixes and confirm readiness.',
    },
    qualityEvidence: {
      planned: 120,
      executed: 84,
      passed: 79,
      openCritical: 1,
      blocked: 5,
      automationPercent: 18,
    },
    achievements: 'Execution reached 70% of plan.',
    aiValue: {
      useCase: '',
      measurableBenefit: '',
      humanValidation: '',
      nextExperimentConstraint: '',
    },
    exceptions: [],
    leadershipAsk: '',
    noLeadershipAsk: true,
    statusRationale: '',
    metricsNote: '',
    ...overrides,
  };
}

describe('goal field boundaries (R5.2)', () => {
  it('accepts a fully valid all-green update', () => {
    expect(validateSubmission(validValues()).success).toBe(true);
  });

  it('rejects an empty goal field', () => {
    const result = validateSubmission(
      validValues({
        goals: {
          business: '',
          technicalTesting: 'x',
          sprintCommitment: 'x',
          nextWeekCommitment: 'x',
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'goals.business')).toBe(true);
  });

  it('rejects a whitespace-only goal field', () => {
    const result = validateSubmission(
      validValues({
        goals: {
          business: '     \n\t  ',
          technicalTesting: 'x',
          sprintCommitment: 'x',
          nextWeekCommitment: 'x',
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'goals.business')).toBe(true);
  });

  it('accepts a 1,000-character goal (min capacity, not min length)', () => {
    const thousand = 'a'.repeat(GOAL_MIN_CAPACITY);
    const result = validateSubmission(
      validValues({
        goals: {
          business: thousand,
          technicalTesting: thousand,
          sprintCommitment: thousand,
          nextWeekCommitment: thousand,
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a 4,000-character goal (configurable maximum)', () => {
    const max = 'b'.repeat(GOAL_MAX_LENGTH);
    const result = validateSubmission(validValues({ goals: {
      business: max,
      technicalTesting: 'x',
      sprintCommitment: 'x',
      nextWeekCommitment: 'x',
    } }));
    expect(result.success).toBe(true);
  });

  it('rejects a goal above the 4,000-character maximum', () => {
    const tooLong = 'c'.repeat(GOAL_MAX_LENGTH + 1);
    const result = validateSubmission(validValues({ goals: {
      business: tooLong,
      technicalTesting: 'x',
      sprintCommitment: 'x',
      nextWeekCommitment: 'x',
    } }));
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'goals.business')).toBe(true);
  });

  it('does not require 1,000 characters — short non-whitespace text is valid', () => {
    const result = validateSubmission(validValues({ goals: {
      business: 'Ship it.',
      technicalTesting: 'Test it.',
      sprintCommitment: 'Prove it.',
      nextWeekCommitment: 'Confirm it.',
    } }));
    expect(result.success).toBe(true);
  });

  it('preserves line breaks in goal content', () => {
    const multiline = 'line one\nline two\nline three';
    const result = validateSubmission(validValues({ goals: {
      business: multiline,
      technicalTesting: 'x',
      sprintCommitment: 'x',
      nextWeekCommitment: 'x',
    } }));
    expect(result.success).toBe(true);
  });
});

describe('numeric evidence (R6.2)', () => {
  it('rejects a negative count', () => {
    const result = validateSubmission(
      validValues({
        qualityEvidence: {
          planned: -1,
          executed: 0,
          passed: 0,
          openCritical: 0,
          blocked: 0,
          automationPercent: 10,
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'qualityEvidence.planned')).toBe(true);
  });

  it('rejects automation above 100', () => {
    const result = validateSubmission(
      validValues({
        qualityEvidence: {
          planned: 10,
          executed: 5,
          passed: 5,
          openCritical: 0,
          blocked: 0,
          automationPercent: 120,
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'qualityEvidence.automationPercent')).toBe(true);
  });

  it('requires an explanation when passed exceeds executed (R6.3)', () => {
    const inconsistent = validValues({
      qualityEvidence: {
        planned: 100,
        executed: 50,
        passed: 60,
        openCritical: 0,
        blocked: 0,
        automationPercent: 10,
      },
    });
    expect(validateSubmission(inconsistent).success).toBe(false);
    expect(validateSubmission(inconsistent).errors.some((e) => e.path === 'metricsNote')).toBe(true);

    const withNote = { ...inconsistent, metricsNote: 'Re-run counted retries.' };
    expect(validateSubmission(withNote).success).toBe(true);
  });
});

describe('Amber/Red rule (R4.3)', () => {
  it('blocks a non-green status with no exception and no rationale', () => {
    const result = validateSubmission(
      validValues({ rag: { business: 'GREEN', delivery: 'AMBER', release: 'GREEN' } }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'statusRationale')).toBe(true);
  });

  it('accepts a non-green status when a rationale is provided', () => {
    const result = validateSubmission(
      validValues({
        rag: { business: 'GREEN', delivery: 'AMBER', release: 'GREEN' },
        statusRationale: 'Amber because environment slot is still being confirmed.',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a non-green status when an exception is present', () => {
    const result = validateSubmission(
      validValues({
        rag: { business: 'RED', delivery: 'AMBER', release: 'RED' },
        exceptions: [
          {
            id: 'e1',
            type: 'BLOCKER',
            impact: 'Pipeline stopped.',
            owner: 'DevOps',
            dueDate: '2026-08-27',
            decisionSupport: 'Approve firewall rule.',
            status: 'OPEN',
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('exception completeness (R9.3)', () => {
  it('rejects an exception missing owner and due date', () => {
    const result = validateSubmission(
      validValues({
        rag: { business: 'AMBER', delivery: 'GREEN', release: 'GREEN' },
        exceptions: [
          {
            id: 'e1',
            type: 'RISK',
            impact: 'Something might slip.',
            owner: '',
            dueDate: '',
            decisionSupport: 'Decide soon.',
            status: 'OPEN',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'exceptions.0.owner')).toBe(true);
    expect(result.errors.some((e) => e.path === 'exceptions.0.dueDate')).toBe(true);
  });
});

describe('AI conditional validation (R8.2)', () => {
  it('requires human validation and measurable benefit when a use case is reported', () => {
    const result = validateSubmission(
      validValues({
        aiValue: {
          useCase: 'AI-assisted test generation',
          measurableBenefit: '',
          humanValidation: '',
          nextExperimentConstraint: '',
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'aiValue.humanValidation')).toBe(true);
    expect(result.errors.some((e) => e.path === 'aiValue.measurableBenefit')).toBe(true);
  });

  it('accepts an AI use case with validation and a "not measured" benefit note', () => {
    const result = validateSubmission(
      validValues({
        aiValue: {
          useCase: 'AI-assisted test generation',
          measurableBenefit: 'Not measured yet this sprint.',
          humanValidation: 'Test lead reviewed all generated cases.',
          nextExperimentConstraint: 'Extend with human approval retained.',
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('does not require AI fields when no use case is reported', () => {
    expect(validateSubmission(validValues()).success).toBe(true);
  });
});

describe('Achievements required (R7)', () => {
  it('blocks submission when achievements is empty', () => {
    const result = validateSubmission(validValues({ achievements: '   ' }));
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'achievements')).toBe(true);
  });
});

describe('AI any-field-requires-use-case (R8)', () => {
  it('requires a use case when only the benefit is entered', () => {
    const result = validateSubmission(
      validValues({
        aiValue: {
          useCase: '',
          measurableBenefit: 'Saved time',
          humanValidation: '',
          nextExperimentConstraint: '',
        },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'aiValue.useCase')).toBe(true);
  });
});

describe('explicit leadership ask (R10)', () => {
  it('blocks submission when neither ask text nor the no-ask choice is set', () => {
    const result = validateSubmission(validValues({ leadershipAsk: '', noLeadershipAsk: false }));
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'leadershipAsk')).toBe(true);
  });

  it('accepts an explicit "no leadership ask" choice', () => {
    expect(validateSubmission(validValues({ leadershipAsk: '', noLeadershipAsk: true })).success).toBe(true);
  });

  it('accepts explicit ask text', () => {
    expect(
      validateSubmission(validValues({ leadershipAsk: 'Approve stage access', noLeadershipAsk: false })).success,
    ).toBe(true);
  });
});

describe('exception resolution (R9.4)', () => {
  it('requires a resolution date and note when an item is resolved', () => {
    const result = validateSubmission(
      validValues({
        rag: { business: 'AMBER', delivery: 'GREEN', release: 'GREEN' },
        exceptions: [
          {
            id: 'e1',
            type: 'RISK',
            impact: 'Environment risk.',
            owner: 'Env lead',
            dueDate: '2026-08-30',
            decisionSupport: 'Confirm slot.',
            status: 'RESOLVED',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === 'exceptions.0.resolvedAt')).toBe(true);
    expect(result.errors.some((e) => e.path === 'exceptions.0.resolutionNote')).toBe(true);
  });

  it('accepts a resolved item with date and note', () => {
    const result = validateSubmission(
      validValues({
        rag: { business: 'AMBER', delivery: 'GREEN', release: 'GREEN' },
        exceptions: [
          {
            id: 'e1',
            type: 'RISK',
            impact: 'Environment risk.',
            owner: 'Env lead',
            dueDate: '2026-08-30',
            decisionSupport: 'Confirm slot.',
            status: 'RESOLVED',
            resolvedAt: '2026-08-29',
            resolutionNote: 'Environment slot confirmed.',
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('deriveEnvelopeFlags', () => {
  const basePayload = (): UpdatePayload => ({
    goals: { business: 'a', technicalTesting: 'b', sprintCommitment: 'c', nextWeekCommitment: 'd' },
    qualityEvidence: {
      planned: 1,
      executed: 1,
      passed: 1,
      openCritical: 0,
      blocked: 0,
      automationPercent: 0,
    },
    achievements: '',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: 'None',
  });

  it('detects a blocker and a real leadership ask', () => {
    const payload = basePayload();
    payload.exceptions = [
      {
        id: 'x',
        type: 'BLOCKER',
        impact: 'i',
        owner: 'o',
        dueDate: '2026-08-27',
        decisionSupport: 'd',
        status: 'OPEN',
      },
    ];
    payload.leadershipAsk = 'Approve stage access today.';
    expect(deriveEnvelopeFlags(payload)).toEqual({ hasBlocker: true, hasLeadershipAsk: true });
  });

  it('treats "None" as no leadership ask', () => {
    expect(deriveEnvelopeFlags(basePayload())).toEqual({
      hasBlocker: false,
      hasLeadershipAsk: false,
    });
  });

  it('does not count a RESOLVED blocker as a current blocker', () => {
    const payload = basePayload();
    payload.exceptions = [
      {
        id: 'x',
        type: 'BLOCKER',
        impact: 'i',
        owner: 'o',
        dueDate: '2026-08-27',
        decisionSupport: 'd',
        status: 'RESOLVED',
        resolvedAt: '2026-08-27',
        resolutionNote: 'done',
      },
    ];
    expect(deriveEnvelopeFlags(payload).hasBlocker).toBe(false);
  });
});
