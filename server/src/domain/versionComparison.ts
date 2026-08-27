/**
 * Field-level version comparison (task 7.8, requirements.md R14.3).
 *
 * "Authorised users SHALL be able to compare two update versions field by
 * field." This module holds the pure, vendor-neutral logic that turns two
 * immutable {@link UpdateVersion} snapshots into a structured diff: for every
 * update field it reports the previous and new value and whether it changed,
 * and it reconciles the exceptions list by id (added / removed / modified /
 * unchanged).
 *
 * The comparison is a *derived read model* — it never mutates either version
 * (both stay immutable, R14.1) and never touches persistence. It reads only the
 * stable, versioned shapes from `documents.ts`, so it works identically on the
 * server and (mirrored) on the client. Direction is fixed by `versionNumber`:
 * `previous` is always the lower version, `current` the higher, so "previous vs
 * new value" is well-defined regardless of the order the ids are supplied in
 * (mirrors the audit `previousVersion`/`newVersion` framing, R14.2).
 */
import type {
  ExceptionItem,
  UpdatePayload,
  UpdateVersion,
} from './documents.js';

/** A single comparable scalar value. Missing/absent values normalise to null. */
export type ComparableValue = string | number | null;

/** The comparison outcome for one scalar field. */
export interface FieldComparison {
  /** Stable dotted path, e.g. `rag.business`, `qualityEvidence.planned`. */
  path: string;
  /** Human-readable label for display. */
  label: string;
  /** The value on the earlier (previous) version. */
  previous: ComparableValue;
  /** The value on the later (current) version. */
  current: ComparableValue;
  /** True when previous and current differ. */
  changed: boolean;
}

/** How an exception line changed between the two versions. */
export type ExceptionChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED' | 'UNCHANGED';

/** The comparison outcome for one exception (matched by its stable id). */
export interface ExceptionComparison {
  /** The exception id used to pair the two sides. */
  id: string;
  changeType: ExceptionChangeType;
  /** Per-field diff within the exception (previous/current/changed). */
  fields: FieldComparison[];
}

/** A lightweight reference to one side of the comparison. */
export interface VersionRef {
  versionId: string;
  versionNumber: number;
  submittedBy: string;
  submittedAt: string;
}

/** The full structured diff between two immutable versions. */
export interface VersionComparison {
  /** The earlier version (lower `versionNumber`). */
  previous: VersionRef;
  /** The later version (higher `versionNumber`). */
  current: VersionRef;
  /** Scalar field comparisons across every update field. */
  fields: FieldComparison[];
  /** Exception-line comparisons, paired by id. */
  exceptions: ExceptionComparison[];
  /** Convenience list of every changed path (scalar fields + `exceptions.<id>`). */
  changedPaths: string[];
  /** True when any field or exception differs. */
  hasChanges: boolean;
}

/** Definition of one scalar field to compare, with its selector + label. */
interface FieldSpec {
  path: string;
  label: string;
  select: (payload: UpdatePayload, version: UpdateVersion) => ComparableValue;
}

/**
 * Every scalar update field, in a stable display order: RAG, goals/commitments,
 * quality evidence, achievements, AI value, notes and the leadership ask.
 * Exceptions are handled separately (they are a keyed list, not a scalar).
 */
const FIELD_SPECS: readonly FieldSpec[] = [
  { path: 'rag.business', label: 'Business RAG', select: (_p, v) => v.rag.business },
  { path: 'rag.delivery', label: 'Delivery RAG', select: (_p, v) => v.rag.delivery },
  { path: 'rag.release', label: 'Release RAG', select: (_p, v) => v.rag.release },

  { path: 'goals.business', label: 'Business goal', select: (p) => p.goals.business },
  {
    path: 'goals.technicalTesting',
    label: 'Technical / testing goal',
    select: (p) => p.goals.technicalTesting,
  },
  {
    path: 'goals.sprintCommitment',
    label: 'Sprint commitment',
    select: (p) => p.goals.sprintCommitment,
  },
  {
    path: 'goals.nextWeekCommitment',
    label: 'Next-week commitment',
    select: (p) => p.goals.nextWeekCommitment,
  },

  { path: 'qualityEvidence.planned', label: 'Tests planned', select: (p) => p.qualityEvidence.planned },
  {
    path: 'qualityEvidence.executed',
    label: 'Tests executed',
    select: (p) => p.qualityEvidence.executed,
  },
  { path: 'qualityEvidence.passed', label: 'Tests passed', select: (p) => p.qualityEvidence.passed },
  {
    path: 'qualityEvidence.openCritical',
    label: 'Open critical defects',
    select: (p) => p.qualityEvidence.openCritical,
  },
  { path: 'qualityEvidence.blocked', label: 'Blocked tests', select: (p) => p.qualityEvidence.blocked },
  {
    path: 'qualityEvidence.automationPercent',
    label: 'Automation %',
    select: (p) => p.qualityEvidence.automationPercent,
  },

  { path: 'achievements', label: 'Achievements', select: (p) => p.achievements },

  { path: 'aiValue.useCase', label: 'AI use case', select: (p) => p.aiValue.useCase },
  {
    path: 'aiValue.measurableBenefit',
    label: 'AI measurable benefit',
    select: (p) => p.aiValue.measurableBenefit,
  },
  {
    path: 'aiValue.humanValidation',
    label: 'AI human validation',
    select: (p) => p.aiValue.humanValidation,
  },
  {
    path: 'aiValue.nextExperimentConstraint',
    label: 'AI next experiment / constraint',
    select: (p) => p.aiValue.nextExperimentConstraint,
  },

  { path: 'leadershipAsk', label: 'Leadership ask', select: (p) => p.leadershipAsk },
  {
    path: 'statusRationale',
    label: 'Status rationale',
    select: (p) => normaliseOptional(p.statusRationale),
  },
  { path: 'metricsNote', label: 'Metrics note', select: (p) => normaliseOptional(p.metricsNote) },
];

/** The scalar fields compared within each exception line. */
interface ExceptionFieldSpec {
  key: keyof ExceptionItem;
  label: string;
}

const EXCEPTION_FIELD_SPECS: readonly ExceptionFieldSpec[] = [
  { key: 'type', label: 'Type' },
  { key: 'impact', label: 'Impact' },
  { key: 'owner', label: 'Owner' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'decisionSupport', label: 'Decision support' },
  { key: 'status', label: 'Status' },
  { key: 'resolvedAt', label: 'Resolved at' },
  { key: 'resolutionNote', label: 'Resolution note' },
];

/**
 * Compare two immutable submitted versions field by field (R14.3).
 *
 * The two arguments may be supplied in any order — the result always orders
 * them by `versionNumber` so `previous` is the earlier submission and `current`
 * the later one. Neither version is mutated.
 */
export function compareVersions(a: UpdateVersion, b: UpdateVersion): VersionComparison {
  // Fix the direction: lower versionNumber is "previous", higher is "current".
  const [previous, current] = a.versionNumber <= b.versionNumber ? [a, b] : [b, a];

  const fields = FIELD_SPECS.map<FieldComparison>((spec) => {
    const previousValue = spec.select(previous.payload, previous);
    const currentValue = spec.select(current.payload, current);
    return {
      path: spec.path,
      label: spec.label,
      previous: previousValue,
      current: currentValue,
      changed: previousValue !== currentValue,
    };
  });

  const exceptions = compareExceptions(
    previous.payload.exceptions,
    current.payload.exceptions,
  );

  const changedPaths = [
    ...fields.filter((field) => field.changed).map((field) => field.path),
    ...exceptions
      .filter((exception) => exception.changeType !== 'UNCHANGED')
      .map((exception) => `exceptions.${exception.id}`),
  ];

  return {
    previous: toRef(previous),
    current: toRef(current),
    fields,
    exceptions,
    changedPaths,
    hasChanges: changedPaths.length > 0,
  };
}

/**
 * Reconcile the two exception lists by their stable id. An id present only on
 * the previous side is REMOVED; only on the current side is ADDED; on both is
 * MODIFIED or UNCHANGED depending on its field values. Results are ordered by
 * the current list first (in its own order), then any removed exceptions.
 */
function compareExceptions(
  previous: ExceptionItem[],
  current: ExceptionItem[],
): ExceptionComparison[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const result: ExceptionComparison[] = [];

  // Walk the current list first so unchanged/added/modified appear in the order
  // a reader sees them on the newer version.
  for (const currentItem of current) {
    const previousItem = previousById.get(currentItem.id);
    if (!previousItem) {
      result.push({
        id: currentItem.id,
        changeType: 'ADDED',
        fields: exceptionFields(undefined, currentItem),
      });
      continue;
    }
    const fields = exceptionFields(previousItem, currentItem);
    const changed = fields.some((field) => field.changed);
    result.push({
      id: currentItem.id,
      changeType: changed ? 'MODIFIED' : 'UNCHANGED',
      fields,
    });
  }

  // Anything only on the previous side was removed.
  for (const previousItem of previous) {
    if (!currentById.has(previousItem.id)) {
      result.push({
        id: previousItem.id,
        changeType: 'REMOVED',
        fields: exceptionFields(previousItem, undefined),
      });
    }
  }

  return result;
}

/** Build the per-field diff for one exception line (either side may be absent). */
function exceptionFields(
  previous: ExceptionItem | undefined,
  current: ExceptionItem | undefined,
): FieldComparison[] {
  return EXCEPTION_FIELD_SPECS.map<FieldComparison>((spec) => {
    const previousValue = previous ? normaliseOptional(previous[spec.key]) : null;
    const currentValue = current ? normaliseOptional(current[spec.key]) : null;
    return {
      path: spec.key,
      label: spec.label,
      previous: previousValue,
      current: currentValue,
      changed: previousValue !== currentValue,
    };
  });
}

/**
 * Normalise an optional string field so "no content" compares equal regardless
 * of how it was stored: an absent (`undefined`) or empty (`''`) value both
 * become null. This avoids a spurious change when, e.g., one version omitted an
 * optional note and the other persisted it as an empty string.
 */
function normaliseOptional(value: string | undefined): ComparableValue {
  if (value === undefined || value === '') return null;
  return value;
}

/** Reduce a full version to the lightweight reference shown on each side. */
function toRef(version: UpdateVersion): VersionRef {
  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    submittedBy: version.submittedBy,
    submittedAt: version.submittedAt,
  };
}
