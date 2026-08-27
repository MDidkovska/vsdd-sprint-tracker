import type { TeamUpdateFormValues } from '../../domain/schemas';
import type { UpdateDocument, UpdatePayload } from '../../domain/update';

/** True when a stored ask represents the explicit "no leadership ask" choice. */
function isNoAsk(ask: string): boolean {
  const trimmed = ask.trim().toLowerCase();
  return trimmed === '' || trimmed === 'none';
}

/** Map a stored document into editable form values. */
export function documentToFormValues(doc: UpdateDocument): TeamUpdateFormValues {
  const p = doc.payload;
  const noAsk = isNoAsk(p.leadershipAsk);
  return {
    rag: { ...doc.rag },
    goals: { ...p.goals },
    qualityEvidence: { ...p.qualityEvidence },
    achievements: p.achievements,
    aiValue: { ...p.aiValue },
    exceptions: p.exceptions.map((item) => ({
      ...item,
      resolvedAt: item.resolvedAt ?? '',
      resolutionNote: item.resolutionNote ?? '',
    })),
    // A freshly-loaded Missing update has an empty ask and no explicit choice yet.
    leadershipAsk: noAsk ? '' : p.leadershipAsk,
    noLeadershipAsk: doc.state === 'MISSING' ? false : noAsk,
    statusRationale: p.statusRationale ?? '',
    metricsNote: p.metricsNote ?? '',
  };
}

/** Map editable form values back into a payload for persistence. */
export function formValuesToPayload(values: TeamUpdateFormValues): UpdatePayload {
  return {
    goals: { ...values.goals },
    qualityEvidence: { ...values.qualityEvidence },
    achievements: values.achievements,
    aiValue: { ...values.aiValue },
    exceptions: values.exceptions.map((item) => ({
      ...item,
      // Clear resolution fields unless the item is actually resolved.
      resolvedAt: item.status === 'RESOLVED' ? item.resolvedAt : '',
      resolutionNote: item.status === 'RESOLVED' ? item.resolutionNote : '',
    })),
    // Explicit choice only: "None" when the user chose no ask; otherwise the exact
    // text (empty stays empty and is blocked at submit — never silently "None").
    leadershipAsk: values.noLeadershipAsk ? 'None' : values.leadershipAsk,
    statusRationale: values.statusRationale ?? '',
    metricsNote: values.metricsNote ?? '',
  };
}

export interface CompletenessState {
  goals: boolean;
  evidence: boolean;
  ai: boolean;
  exceptions: boolean;
  completeCount: number;
}

/** Section completeness for the context-rail checklist (task 4.3). */
export function computeCompleteness(values: TeamUpdateFormValues): CompletenessState {
  const goals = [
    values.goals.business,
    values.goals.technicalTesting,
    values.goals.sprintCommitment,
    values.goals.nextWeekCommitment,
  ].every((v) => v.trim().length > 0);

  const evidence = Object.values(values.qualityEvidence).every((v) => Number.isFinite(v));

  const aiValues = Object.values(values.aiValue).map((v) => v.trim());
  const anyAi = aiValues.some(Boolean);
  // Complete when untouched, or when a use case has validation + benefit.
  const ai = !anyAi || (values.aiValue.useCase.trim().length > 0 &&
    values.aiValue.humanValidation.trim().length > 0 &&
    values.aiValue.measurableBenefit.trim().length > 0);

  const exceptions =
    values.exceptions.length === 0 ||
    values.exceptions.every((item) => {
      const baseComplete =
        item.impact.trim() && item.owner.trim() && item.dueDate.trim() && item.decisionSupport.trim();
      if (item.status === 'RESOLVED') {
        return baseComplete && (item.resolvedAt ?? '').trim() && (item.resolutionNote ?? '').trim();
      }
      return baseComplete;
    });

  const completeCount = [goals, evidence, ai, exceptions].filter(Boolean).length;
  return { goals, evidence, ai, exceptions, completeCount };
}
