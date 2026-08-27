/**
 * Server-side submission validation (task 7.5).
 *
 * "Flexible storage does not mean unvalidated data" (design.md §4a / §4b): the
 * cross-field rules that a valid *submitted* update must satisfy are enforced
 * here on the server, independently of the UI. These rules MIRROR the Phase 2
 * frontend contract (`src/domain/schemas.ts` `submissionSchema` +
 * `src/domain/derived.ts` `findMetricInconsistencies`) so a submission accepted
 * by the UI is accepted by the API and vice-versa. The backend is a separate
 * package, so the rules are re-declared in plain TypeScript rather than importing
 * the frontend's Zod schemas — but they must stay behaviourally identical.
 *
 * Errors are returned as flat, dot-path {@link FieldError}s (e.g.
 * `goals.business`, `exceptions.0.owner`) matching the frontend flattened Zod
 * paths and the §6 error envelope `fieldErrors`.
 */
import type { FieldError } from '../http/errorEnvelope.js';
import type {
  QualityEvidence,
  RagStatuses,
  UpdatePayload,
} from './documents.js';

/** Goal/commitment input capacity (mirrors schemas.ts GOAL_MAX_LENGTH). */
export const GOAL_MAX_LENGTH = 4000;
/** Capacity for the larger optional narrative fields. */
export const NARRATIVE_MAX_LENGTH = 4000;
/** Capacity for shorter single-line fields (AI value, owner, ask). */
export const SHORT_TEXT_MAX_LENGTH = 1000;

/** Non-whitespace content guard (mirrors schemas.ts `nonWhitespace`). */
function nonWhitespace(value: string | undefined): boolean {
  return (value ?? '').trim().length > 0;
}

function hasNonGreen(rag: RagStatuses): boolean {
  return rag.business !== 'GREEN' || rag.delivery !== 'GREEN' || rag.release !== 'GREEN';
}

/** Whole-number, zero-or-greater count guard. */
function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export type MetricInconsistency = 'PASSED_GT_EXECUTED' | 'EXECUTED_GT_PLANNED';

/**
 * Non-blocking metric warnings; submission is allowed only with an explanation
 * (R6.3). Mirrors `findMetricInconsistencies` in the frontend `derived.ts`.
 */
export function findMetricInconsistencies(metrics: QualityEvidence): MetricInconsistency[] {
  const issues: MetricInconsistency[] = [];
  if (metrics.passed > metrics.executed) issues.push('PASSED_GT_EXECUTED');
  if (metrics.executed > metrics.planned) issues.push('EXECUTED_GT_PLANNED');
  return issues;
}

const GOAL_FIELDS: Array<keyof UpdatePayload['goals']> = [
  'business',
  'technicalTesting',
  'sprintCommitment',
  'nextWeekCommitment',
];

/**
 * Validate a full submission payload against the R4–R10 cross-field rules.
 * Returns an empty array when the update is valid; otherwise a flat list of
 * dot-path field errors ready for the §6 error envelope.
 */
export function validateSubmission(
  rag: RagStatuses,
  payload: UpdatePayload,
): FieldError[] {
  const errors: FieldError[] = [];

  // R5.2 — the four goal/commitment fields are required (non-whitespace) and
  // must stay within capacity.
  for (const field of GOAL_FIELDS) {
    const value = payload.goals[field];
    if (!nonWhitespace(value)) {
      errors.push({ path: `goals.${field}`, message: 'This field is required.' });
    } else if (value.length > GOAL_MAX_LENGTH) {
      errors.push({
        path: `goals.${field}`,
        message: `Keep this within ${GOAL_MAX_LENGTH} characters.`,
      });
    }
  }

  // R6 — numeric validation: counts are whole numbers, zero or greater; the
  // automation percentage is a whole number between 0 and 100.
  const metrics = payload.qualityEvidence;
  const countFields: Array<keyof QualityEvidence> = [
    'planned',
    'executed',
    'passed',
    'openCritical',
    'blocked',
  ];
  for (const field of countFields) {
    if (!isCount(metrics[field])) {
      errors.push({
        path: `qualityEvidence.${field}`,
        message: 'Enter a whole number of zero or greater.',
      });
    }
  }
  if (
    !Number.isInteger(metrics.automationPercent) ||
    metrics.automationPercent < 0 ||
    metrics.automationPercent > 100
  ) {
    errors.push({
      path: 'qualityEvidence.automationPercent',
      message: 'Must be a whole number between 0 and 100.',
    });
  }

  // R9 — every exception needs an impact, owner, due date and decision/support;
  // a resolved item additionally needs a resolution date and note.
  payload.exceptions.forEach((item, index) => {
    if (!nonWhitespace(item.impact)) {
      errors.push({
        path: `exceptions.${index}.impact`,
        message: 'Business / release impact is required.',
      });
    }
    if (!nonWhitespace(item.owner)) {
      errors.push({ path: `exceptions.${index}.owner`, message: 'Owner is required.' });
    }
    if (!nonWhitespace(item.dueDate)) {
      errors.push({ path: `exceptions.${index}.dueDate`, message: 'Due date is required.' });
    }
    if (!nonWhitespace(item.decisionSupport)) {
      errors.push({
        path: `exceptions.${index}.decisionSupport`,
        message: 'Decision / support needed is required.',
      });
    }
    if (item.status === 'RESOLVED') {
      if (!nonWhitespace(item.resolvedAt)) {
        errors.push({
          path: `exceptions.${index}.resolvedAt`,
          message: 'A resolution date is required to resolve this item.',
        });
      }
      if (!nonWhitespace(item.resolutionNote)) {
        errors.push({
          path: `exceptions.${index}.resolutionNote`,
          message: 'A resolution note is required to resolve this item.',
        });
      }
    }
  });

  // R4.3 — a non-green status needs at least one exception OR a written rationale.
  if (hasNonGreen(rag) && payload.exceptions.length === 0 && !nonWhitespace(payload.statusRationale)) {
    errors.push({
      path: 'statusRationale',
      message:
        'A non-green status needs at least one risk, issue or blocker — or a written rationale.',
    });
  }

  // R7 — Achievements this week is required for submission.
  if (!nonWhitespace(payload.achievements)) {
    errors.push({
      path: 'achievements',
      message: 'Describe what changed against this week’s commitment.',
    });
  }

  // R8.2 — AI conditional validation. If ANY AI field is entered, a use case is
  // required; a reported use case then requires human validation and a
  // measurable benefit (or an explicit "not measured" explanation).
  const ai = payload.aiValue;
  const anyAiEntered = [
    ai.useCase,
    ai.measurableBenefit,
    ai.humanValidation,
    ai.nextExperimentConstraint,
  ].some(nonWhitespace);
  if (anyAiEntered && !nonWhitespace(ai.useCase)) {
    errors.push({
      path: 'aiValue.useCase',
      message: 'Record the AI use case before adding other AI details.',
    });
  }
  if (nonWhitespace(ai.useCase)) {
    if (!nonWhitespace(ai.humanValidation)) {
      errors.push({
        path: 'aiValue.humanValidation',
        message: 'Human validation is required when an AI use case is reported.',
      });
    }
    if (!nonWhitespace(ai.measurableBenefit)) {
      errors.push({
        path: 'aiValue.measurableBenefit',
        message: 'Record a measurable benefit, or state explicitly that it was not measured.',
      });
    }
  }

  // R10 — the leadership ask must be an explicit choice: either ask text or the
  // explicit "None" sent by the UI. An empty field is never silently accepted.
  if (!nonWhitespace(payload.leadershipAsk)) {
    errors.push({
      path: 'leadershipAsk',
      message: 'Enter a leadership ask, or choose “No leadership ask”.',
    });
  }

  // R6.3 — a metric inconsistency is overridable only with an explanation.
  if (findMetricInconsistencies(metrics).length > 0 && !nonWhitespace(payload.metricsNote)) {
    errors.push({
      path: 'metricsNote',
      message: 'Explain the metric inconsistency before submitting.',
    });
  }

  return errors;
}
