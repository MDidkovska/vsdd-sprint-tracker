/**
 * Zod schemas + explicit validation for the Team Update.
 *
 * Two levels of validation:
 *  - Draft level: structural typing only (autosave never blocks authoring).
 *  - Submission level: full required-field + cross-field rules (R4–R9).
 *
 * Flexible storage does NOT mean unvalidated data (design.md §4a): every rule
 * lives here in TypeScript/Zod and is shared by the UI and (later) the API.
 */
import { z } from 'zod';
import { findMetricInconsistencies } from './derived';
import type { RagStatuses, UpdatePayload } from './update';

/**
 * Goal/commitment field capacity. R5.2 describes *input capacity*, not a
 * minimum length: the four fields are required and must contain non-whitespace
 * text, must preserve line breaks, and must support at least 1,000 characters —
 * but users are NOT required to type 1,000 characters. Phase A caps input at a
 * configurable maximum of 4,000 characters.
 */
export const GOAL_MIN_CAPACITY = 1000;
export const GOAL_MAX_LENGTH = 4000;

/** Free-text capacity for the larger optional narrative fields. */
export const NARRATIVE_MAX_LENGTH = 4000;
/** Capacity for shorter single-line fields (AI value, owner, ask). */
export const SHORT_TEXT_MAX_LENGTH = 1000;

const nonWhitespace = (value: string) => value.trim().length > 0;

/**
 * Required goal field: non-empty, non-whitespace, within capacity. Internal
 * line breaks are preserved (we only assert trimmed content is non-empty).
 */
export const goalFieldSchema = z
  .string()
  .max(GOAL_MAX_LENGTH, `Keep this within ${GOAL_MAX_LENGTH} characters.`)
  .refine(nonWhitespace, { message: 'This field is required.' });

export const ragValueSchema = z.enum(['GREEN', 'AMBER', 'RED']);

export const ragStatusesSchema = z.object({
  business: ragValueSchema,
  delivery: ragValueSchema,
  release: ragValueSchema,
});

const countSchema = z.coerce
  .number({ invalid_type_error: 'Enter a whole number.' })
  .int('Enter a whole number.')
  .min(0, 'Must be zero or greater.');

export const qualityEvidenceSchema = z.object({
  planned: countSchema,
  executed: countSchema,
  passed: countSchema,
  openCritical: countSchema,
  blocked: countSchema,
  automationPercent: z.coerce
    .number({ invalid_type_error: 'Enter a number.' })
    .int('Enter a whole number.')
    .min(0, 'Must be between 0 and 100.')
    .max(100, 'Must be between 0 and 100.'),
});

export const goalsSchema = z.object({
  business: goalFieldSchema,
  technicalTesting: goalFieldSchema,
  sprintCommitment: goalFieldSchema,
  nextWeekCommitment: goalFieldSchema,
});

export const aiValueSchema = z.object({
  useCase: z.string().max(SHORT_TEXT_MAX_LENGTH),
  measurableBenefit: z.string().max(SHORT_TEXT_MAX_LENGTH),
  humanValidation: z.string().max(SHORT_TEXT_MAX_LENGTH),
  nextExperimentConstraint: z.string().max(SHORT_TEXT_MAX_LENGTH),
});

export const exceptionSchema = z
  .object({
    id: z.string(),
    type: z.enum(['RISK', 'ISSUE', 'BLOCKER']),
    impact: z.string().max(NARRATIVE_MAX_LENGTH).refine(nonWhitespace, {
      message: 'Business / release impact is required.',
    }),
    owner: z.string().max(SHORT_TEXT_MAX_LENGTH).refine(nonWhitespace, {
      message: 'Owner is required.',
    }),
    dueDate: z.string().refine(nonWhitespace, { message: 'Due date is required.' }),
    decisionSupport: z.string().max(NARRATIVE_MAX_LENGTH).refine(nonWhitespace, {
      message: 'Decision / support needed is required.',
    }),
    status: z.enum(['OPEN', 'RESOLVED']),
    resolvedAt: z.string().optional(),
    resolutionNote: z.string().max(NARRATIVE_MAX_LENGTH).optional(),
  })
  .superRefine((item, ctx) => {
    // Resolving an item requires a resolution date and a resolution note (R9.4).
    if (item.status === 'RESOLVED') {
      if (!nonWhitespace(item.resolvedAt ?? '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resolvedAt'],
          message: 'A resolution date is required to resolve this item.',
        });
      }
      if (!nonWhitespace(item.resolutionNote ?? '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['resolutionNote'],
          message: 'A resolution note is required to resolve this item.',
        });
      }
    }
  });

/** Editable form values (mirror of the payload plus RAG). */
export const teamUpdateFormSchema = z.object({
  rag: ragStatusesSchema,
  goals: goalsSchema,
  qualityEvidence: qualityEvidenceSchema,
  achievements: z.string().max(NARRATIVE_MAX_LENGTH),
  aiValue: aiValueSchema,
  exceptions: z.array(exceptionSchema),
  leadershipAsk: z.string().max(NARRATIVE_MAX_LENGTH),
  /** Explicit "no leadership ask" choice — empty is never silently treated as None. */
  noLeadershipAsk: z.boolean().default(false),
  statusRationale: z.string().max(NARRATIVE_MAX_LENGTH).optional().default(''),
  metricsNote: z.string().max(NARRATIVE_MAX_LENGTH).optional().default(''),
});

export type TeamUpdateFormValues = z.infer<typeof teamUpdateFormSchema>;

function hasNonGreen(rag: RagStatuses): boolean {
  return rag.business !== 'GREEN' || rag.delivery !== 'GREEN' || rag.release !== 'GREEN';
}

/**
 * Full submission schema. Adds the cross-field rules that a valid *submitted*
 * update must satisfy on top of the structural form schema.
 */
export const submissionSchema = teamUpdateFormSchema.superRefine((values, ctx) => {
  // R4.3 — Amber/Red requires at least one exception OR a written rationale.
  if (hasNonGreen(values.rag) && values.exceptions.length === 0) {
    if (!nonWhitespace(values.statusRationale ?? '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statusRationale'],
        message:
          'A non-green status needs at least one risk, issue or blocker — or a written rationale.',
      });
    }
  }

  // R7 — Achievements this week is required for submission.
  if (!nonWhitespace(values.achievements)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['achievements'],
      message: 'Describe what changed against this week’s commitment.',
    });
  }

  // R8.2 — if ANY AI field is entered, a Use case is required; and a reported
  // use case requires human validation and a measurable benefit (or an explicit
  // "not measured" explanation typed in the benefit field).
  const anyAiEntered = [
    values.aiValue.useCase,
    values.aiValue.measurableBenefit,
    values.aiValue.humanValidation,
    values.aiValue.nextExperimentConstraint,
  ].some(nonWhitespace);
  if (anyAiEntered && !nonWhitespace(values.aiValue.useCase)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['aiValue', 'useCase'],
      message: 'Record the AI use case before adding other AI details.',
    });
  }
  if (nonWhitespace(values.aiValue.useCase)) {
    if (!nonWhitespace(values.aiValue.humanValidation)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aiValue', 'humanValidation'],
        message: 'Human validation is required when an AI use case is reported.',
      });
    }
    if (!nonWhitespace(values.aiValue.measurableBenefit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aiValue', 'measurableBenefit'],
        message:
          'Record a measurable benefit, or state explicitly that it was not measured.',
      });
    }
  }

  // R10 — the leadership ask must be an explicit choice: either ask text, or the
  // explicit "No leadership ask" option. An empty field is never silently "None".
  if (!values.noLeadershipAsk && !nonWhitespace(values.leadershipAsk)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['leadershipAsk'],
      message: 'Enter a leadership ask, or choose “No leadership ask”.',
    });
  }

  // R6.3 — metric inconsistencies are overridable only with an explanation.
  if (findMetricInconsistencies(values.qualityEvidence).length > 0) {
    if (!nonWhitespace(values.metricsNote ?? '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metricsNote'],
        message: 'Explain the metric inconsistency before submitting.',
      });
    }
  }
});

export interface FlatFieldError {
  path: string; // dot path, e.g. "goals.business" or "exceptions.0.owner"
  message: string;
}

export interface SubmissionValidationResult {
  success: boolean;
  errors: FlatFieldError[];
}

/** Validate a full submission and return flattened, path-keyed errors. */
export function validateSubmission(values: TeamUpdateFormValues): SubmissionValidationResult {
  const result = submissionSchema.safeParse(values);
  if (result.success) {
    return { success: true, errors: [] };
  }
  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return { success: false, errors };
}

/** Convenience: build the denormalised envelope flags from payload content. */
export function deriveEnvelopeFlags(payload: UpdatePayload): {
  hasBlocker: boolean;
  hasLeadershipAsk: boolean;
} {
  // Only an OPEN blocker counts as a current blocker (resolved items are history).
  const hasBlocker = payload.exceptions.some(
    (item) => item.type === 'BLOCKER' && item.status === 'OPEN',
  );
  const ask = payload.leadershipAsk.trim();
  const hasLeadershipAsk = ask.length > 0 && ask.toLowerCase() !== 'none';
  return { hasBlocker, hasLeadershipAsk };
}
