import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, type FieldErrors, type UseFormSetFocus } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { cn } from '../../lib/cn';
import { formatTimestamp } from '../../lib/datetime';
import { GOAL_MAX_LENGTH, submissionSchema, type TeamUpdateFormValues } from '../../domain/schemas';
import {
  calculateDerivedRates,
  findMetricInconsistencies,
  formatRate,
  METRIC_INCONSISTENCY_MESSAGES,
} from '../../domain/derived';
import type { RagValue, UpdateDocument } from '../../domain/update';
import {
  useCheckpoints,
  useCurrentUser,
  useHierarchy,
  useReopenUpdate,
  useSaveDraft,
  useSprints,
  useSubmitUpdate,
  useUpdate,
  useVersions,
} from '../../api/queries';
import { useRepository } from '../../api/RepositoryContext';
import { PermissionDeniedError, RevisionConflictError, type UpdateLocator } from '../../api/repository';
import { useSelection } from '../../app/selection';
import { useToast } from '../../components/Toast';
import { Button } from '../../components/Button';
import { TextField, TextareaField } from '../../components/Field';
import { MetricInput } from '../../components/Metric';
import { RagSelector } from '../../components/RagSelector';
import { ExceptionEditor, exceptionFieldId, type ExceptionField } from '../../components/ExceptionEditor';
import { Skeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { computeCompleteness, documentToFormValues, formValuesToPayload } from './formMapping';
import { UpdateContextRail } from './UpdateContextRail';
import styles from './TeamUpdate.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';
type PersistOutcome = 'saved' | 'failed' | 'conflict';

interface ConflictState {
  serverDoc: UpdateDocument | null;
  localValues: TeamUpdateFormValues;
}

const AUTOSAVE_DEBOUNCE_MS = 700;

const FIELD_LABELS: Record<string, string> = {
  'goals.business': 'Business goal',
  'goals.technicalTesting': 'Technical / testing goal',
  'goals.sprintCommitment': 'Sprint commitment',
  'goals.nextWeekCommitment': 'Next week commitment',
  achievements: 'Achievements this week',
  leadershipAsk: 'Leadership ask',
  statusRationale: 'Status rationale',
  metricsNote: 'Metric inconsistency explanation',
  'aiValue.useCase': 'AI use case',
  'aiValue.humanValidation': 'AI human validation',
  'aiValue.measurableBenefit': 'AI measurable benefit',
};

export function TeamUpdatePage() {
  const { selection, setSelection } = useSelection();
  const { showToast } = useToast();
  const repository = useRepository();

  const { data: user } = useCurrentUser();
  const { data: hierarchy } = useHierarchy(selection.programmeId);
  const { data: sprints } = useSprints(selection.programmeId);
  const { data: checkpoints } = useCheckpoints(selection.sprintId);

  // A deep link may reference a sprint that does not exist; fall back to the
  // current/first sprint so the editor resolves instead of loading forever.
  // (Safe handling of an invalid target — task 9.3.)
  useEffect(() => {
    if (!sprints || sprints.length === 0) return;
    if (sprints.some((s) => s.id === selection.sprintId)) return;
    const fallback = sprints.find((s) => s.status === 'CURRENT') ?? sprints[0]!;
    setSelection({ sprintId: fallback.id });
  }, [sprints, selection.sprintId, setSelection]);
  const checkpoint = useMemo(
    () => checkpoints?.find((c) => c.weekNumber === selection.weekNumber),
    [checkpoints, selection.weekNumber],
  );

  const locator: UpdateLocator = useMemo(
    () => ({
      teamId: selection.teamId,
      sprintId: selection.sprintId,
      checkpointId: checkpoint?.id ?? '',
    }),
    [selection.teamId, selection.sprintId, checkpoint?.id],
  );
  const updateQuery = useUpdate(locator, Boolean(checkpoint));
  const versionsQuery = useVersions(locator, Boolean(checkpoint) && updateQuery.data?.state === 'SUBMITTED');

  const saveDraft = useSaveDraft();
  const submitUpdate = useSubmitUpdate();
  const reopenUpdate = useReopenUpdate();

  const form = useForm<TeamUpdateFormValues>({
    resolver: zodResolver(submissionSchema),
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    defaultValues: emptyFormValues(),
  });
  const { control, register, handleSubmit, reset, watch, getValues, formState, setFocus } = form;

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorSummary, setErrorSummary] = useState<Array<{ path: string; message: string }>>([]);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const revisionRef = useRef(0);
  const loadedKeyRef = useRef<string>('');
  const skipNextAutosave = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doc = updateQuery.data;
  const isAssigned = Boolean(user?.assignedTeamIds.includes(selection.teamId));
  const canSubmitRole = Boolean(user?.roles.includes('TEAM_LEAD'));
  const windowClosed = checkpoint?.status === 'CLOSED';
  const isSubmitted = doc?.state === 'SUBMITTED';
  const conflictActive = conflict !== null;
  // Writes are frozen while a conflict is unresolved.
  const canEdit = isAssigned && !windowClosed && !isSubmitted && Boolean(doc) && !conflictActive;

  const teamName = useMemo(() => {
    for (const group of hierarchy?.streams ?? []) {
      const team = group.teams.find((t) => t.id === selection.teamId);
      if (team) return { streamName: group.stream.name, teamName: team.name };
    }
    return { streamName: selection.streamId, teamName: selection.teamId };
  }, [hierarchy, selection.teamId, selection.streamId]);

  function clearDebounce() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  // Reset the form only when the loaded document identity changes.
  useEffect(() => {
    if (!doc) return;
    if (doc.id === loadedKeyRef.current) return;
    loadedKeyRef.current = doc.id;
    revisionRef.current = doc.revision;
    skipNextAutosave.current = true;
    setConflict(null);
    reset(documentToFormValues(doc));
    setSaveState(doc.state === 'MISSING' ? 'idle' : 'saved');
    setSavedAt(doc.state === 'MISSING' ? null : doc.updatedAt);
    setErrorSummary([]);
  }, [doc, reset]);

  const enterConflict = useCallback(
    async (localValues: TeamUpdateFormValues) => {
      let serverDoc: UpdateDocument | null = null;
      try {
        serverDoc = await repository.getUpdate(locator);
      } catch {
        serverDoc = null;
      }
      // Never auto-update the writable revision on conflict.
      setConflict({ serverDoc, localValues });
      setSaveState('conflict');
    },
    [repository, locator],
  );

  const persist = useCallback(
    async (values: TeamUpdateFormValues): Promise<PersistOutcome> => {
      if (!checkpoint) return 'failed';
      setSaveState('saving');
      try {
        const saved = await saveDraft.mutateAsync({
          teamId: selection.teamId,
          sprintId: selection.sprintId,
          checkpointId: checkpoint.id,
          revision: revisionRef.current,
          rag: values.rag,
          payload: formValuesToPayload(values),
        });
        revisionRef.current = saved.revision;
        setSaveState('saved');
        setSavedAt(saved.updatedAt);
        return 'saved';
      } catch (error) {
        if (error instanceof RevisionConflictError) {
          await enterConflict(values);
          return 'conflict';
        }
        setSaveState('failed');
        return 'failed';
      }
    },
    [checkpoint, saveDraft, selection.teamId, selection.sprintId, enterConflict],
  );

  // Debounced autosave — frozen while a conflict is unresolved or read-only.
  useEffect(() => {
    const subscription = watch(() => {
      if (!canEdit) return;
      if (skipNextAutosave.current) {
        skipNextAutosave.current = false;
        return;
      }
      clearDebounce();
      setSaveState('saving');
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void persist(getValues());
      }, AUTOSAVE_DEBOUNCE_MS);
    });
    return () => subscription.unsubscribe();
  }, [watch, canEdit, persist, getValues]);

  // Warn on page unload while content is unsaved (failed or unresolved conflict).
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (saveState === 'failed' || conflictActive) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [saveState, conflictActive]);

  const confirmContextChange = useCallback(() => {
    // Flush a pending autosave before leaving; block on unresolved conflict/failure.
    if (conflictActive) {
      return window.confirm('You have an unresolved version conflict. Leave without resolving it?');
    }
    if (debounceRef.current) {
      clearDebounce();
      if (canEdit) void persist(getValues());
    }
    if (saveState === 'failed') {
      return window.confirm('This update has changes that failed to save. Leave anyway?');
    }
    return true;
  }, [conflictActive, canEdit, persist, getValues, saveState]);

  async function onManualSave() {
    if (!canEdit) return;
    clearDebounce();
    const outcome = await persist(getValues());
    if (outcome === 'saved') showToast('Draft saved for this team and week.', 'success');
    else if (outcome === 'failed') showToast('Save failed. Your changes are kept for retry.', 'error');
  }

  const onValid = async (values: TeamUpdateFormValues) => {
    if (!checkpoint || conflictActive) return;
    clearDebounce(); // never let a stale autosave race the submission
    setErrorSummary([]);
    try {
      await submitUpdate.mutateAsync({
        teamId: selection.teamId,
        sprintId: selection.sprintId,
        checkpointId: checkpoint.id,
        revision: revisionRef.current,
        rag: values.rag,
        payload: formValuesToPayload(values),
      });
      showToast('Update submitted. Leadership View now uses this version.', 'success');
      setSaveState('saved');
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        await enterConflict(values);
      } else if (error instanceof PermissionDeniedError) {
        showToast(error.message, 'error');
      } else {
        showToast('Submission failed. Your content is kept for retry.', 'error');
      }
    }
  };

  const onInvalid = (errors: FieldErrors<TeamUpdateFormValues>) => {
    const summary = Object.entries(flattenErrors(errors)).map(([path, message]) => ({ path, message }));
    setErrorSummary(summary);
    showToast('Complete the highlighted fields before submitting.', 'error');
  };

  async function onReopen() {
    const version = versionsQuery.data?.[0];
    if (!version) return;
    const reason = window.prompt('Reason for reopening this submitted update:');
    if (!reason || !reason.trim()) return;
    try {
      const reopened = await reopenUpdate.mutateAsync({ versionId: version.id, reason: reason.trim() });
      loadedKeyRef.current = reopened.id;
      revisionRef.current = reopened.revision;
      skipNextAutosave.current = true;
      reset(documentToFormValues(reopened));
      setSaveState('saved');
      showToast('Update reopened. The previous submitted version is preserved.', 'success');
    } catch (error) {
      const message = error instanceof PermissionDeniedError ? error.message : 'Could not reopen the update.';
      showToast(message, 'error');
    }
  }

  function resolveUseServer() {
    if (!conflict?.serverDoc) return;
    const serverDoc = conflict.serverDoc;
    revisionRef.current = serverDoc.revision;
    skipNextAutosave.current = true;
    reset(documentToFormValues(serverDoc));
    setConflict(null);
    setSaveState('saved');
    setSavedAt(serverDoc.updatedAt);
    showToast('Loaded the latest server version. Your unsaved edits were discarded.', 'success');
  }

  async function resolveKeepMine() {
    if (!conflict) return;
    const confirmed = window.confirm(
      'Overwrite the newer server version with your changes? The server version will be replaced.',
    );
    if (!confirmed) return;
    const localValues = conflict.localValues;
    // Target the latest server revision so our explicit overwrite is accepted.
    revisionRef.current = conflict.serverDoc?.revision ?? revisionRef.current;
    setConflict(null);
    skipNextAutosave.current = true;
    reset(localValues);
    const outcome = await persist(localValues);
    if (outcome === 'saved') showToast('Your version was saved over the server draft.', 'success');
  }

  // ---- render ----
  const values = watch();
  const completeness = computeCompleteness(values);
  const rates = calculateDerivedRates(values.qualityEvidence);
  const inconsistencies = findMetricInconsistencies(values.qualityEvidence);
  const anyNonGreen =
    values.rag.business !== 'GREEN' || values.rag.delivery !== 'GREEN' || values.rag.release !== 'GREEN';
  const showRationale = anyNonGreen && values.exceptions.length === 0;
  const noAsk = values.noLeadershipAsk;

  if (updateQuery.isError) {
    return (
      <ErrorState
        title="This update could not be loaded"
        description="There was a problem loading this team update. Try again."
        action={<Button onClick={() => updateQuery.refetch()}>Retry</Button>}
      />
    );
  }

  if (updateQuery.isLoading || !doc) {
    return <TeamUpdateSkeleton />;
  }

  const disabled = !canEdit;

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.contextLine}>
            {teamName.streamName} / {teamName.teamName} / {sprintLabel(selection.sprintId)}
          </p>
          <h1 tabIndex={-1}>
            {sprintLabel(selection.sprintId)} · Week {selection.weekNumber} update
          </h1>
        </div>
        <SaveStateBadge state={saveState} savedAt={savedAt} />
      </div>

      {!isAssigned && (
        <div className={cn(styles.banner, styles.bannerDenied)} role="alert">
          <span>You have read-only access to this team. You are not assigned to edit its updates.</span>
        </div>
      )}
      {isAssigned && windowClosed && (
        <div className={cn(styles.banner, styles.bannerWarn)}>
          <span>This reporting window is closed. Submitted content is read-only.</span>
        </div>
      )}
      {isAssigned && !windowClosed && isSubmitted && (
        <div className={cn(styles.banner, styles.bannerInfo)}>
          <span>This update is submitted and read-only. Reopen it to make changes.</span>
          <Button small onClick={onReopen} disabled={!versionsQuery.data?.length || !canSubmitRole}>
            Reopen to edit
          </Button>
        </div>
      )}

      {conflict && (
        <ConflictPanel
          conflict={conflict}
          onUseServer={resolveUseServer}
          onKeepMine={resolveKeepMine}
        />
      )}

      <div className={styles.shell}>
        <UpdateContextRail completeness={completeness} confirmContextChange={confirmContextChange} />

        <form className={styles.form} onSubmit={handleSubmit(onValid, onInvalid)} noValidate>
          {errorSummary.length > 0 && (
            <div className={styles.errorSummary} role="alert" tabIndex={-1}>
              <h2>Fix these before submitting</h2>
              <ul>
                {errorSummary.map((item) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => focusPath(setFocus, item.path)}
                    >
                      {FIELD_LABELS[item.path] ?? item.path}: {item.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className={styles.statusPanel} disabled={disabled}>
            <legend className="sr-only">Current RAG status</legend>
            <Controller
              control={control}
              name="rag.business"
              render={({ field }) => (
                <RagSelector name="rag-business" label="Business outcome" value={field.value as RagValue} onChange={field.onChange} disabled={disabled} />
              )}
            />
            <Controller
              control={control}
              name="rag.delivery"
              render={({ field }) => (
                <RagSelector name="rag-delivery" label="Test delivery" value={field.value as RagValue} onChange={field.onChange} disabled={disabled} />
              )}
            />
            <Controller
              control={control}
              name="rag.release"
              render={({ field }) => (
                <RagSelector name="rag-release" label="Release confidence" value={field.value as RagValue} onChange={field.onChange} disabled={disabled} />
              )}
            />
          </fieldset>

          {showRationale && (
            <div className={styles.rationale}>
              <TextareaField
                label="Status rationale"
                rows={2}
                required
                hint="A non-green status needs a linked risk/issue/blocker or a written rationale."
                error={fieldError(formState, 'statusRationale')}
                disabled={disabled}
                {...register('statusRationale')}
              />
            </div>
          )}

          <section className={styles.section} aria-labelledby="goals-title">
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="goals-title">Goals &amp; commitments</h2>
                <p>These four fields become the leadership summary.</p>
              </div>
              <span className={styles.requiredNote}>Required for submission</span>
            </div>
            <div className={styles.goalsGrid}>
              <TextareaField label="Business goal" rows={3} required maxLength={GOAL_MAX_LENGTH} hint="Customer, operational or regulatory outcome enabled by this sprint." error={fieldError(formState, 'goals.business')} disabled={disabled} {...register('goals.business')} />
              <TextareaField label="Technical / testing goal" rows={3} required maxLength={GOAL_MAX_LENGTH} hint="Capability, coverage or readiness objective." error={fieldError(formState, 'goals.technicalTesting')} disabled={disabled} {...register('goals.technicalTesting')} />
              <TextareaField label="Sprint commitment" rows={3} required maxLength={GOAL_MAX_LENGTH} hint="Specific evidence or result the team commits to deliver this sprint." error={fieldError(formState, 'goals.sprintCommitment')} disabled={disabled} {...register('goals.sprintCommitment')} />
              <TextareaField label="Next week commitment" rows={3} required maxLength={GOAL_MAX_LENGTH} hint="The next measurable step, not a list of activities." error={fieldError(formState, 'goals.nextWeekCommitment')} disabled={disabled} {...register('goals.nextWeekCommitment')} />
            </div>
          </section>

          <div className={styles.evidenceGrid}>
            <section aria-labelledby="evidence-title">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="evidence-title">Quality evidence</h2>
                  <p>Current cumulative sprint position.</p>
                </div>
              </div>
              <div className={styles.metricsGrid}>
                <MetricInput label="Planned" min={0} error={fieldError(formState, 'qualityEvidence.planned')} disabled={disabled} {...register('qualityEvidence.planned', { valueAsNumber: true })} />
                <MetricInput label="Executed" min={0} error={fieldError(formState, 'qualityEvidence.executed')} disabled={disabled} {...register('qualityEvidence.executed', { valueAsNumber: true })} />
                <MetricInput label="Passed" min={0} error={fieldError(formState, 'qualityEvidence.passed')} disabled={disabled} {...register('qualityEvidence.passed', { valueAsNumber: true })} />
                <MetricInput label="Open critical" min={0} error={fieldError(formState, 'qualityEvidence.openCritical')} disabled={disabled} {...register('qualityEvidence.openCritical', { valueAsNumber: true })} />
                <MetricInput label="Blocked" min={0} error={fieldError(formState, 'qualityEvidence.blocked')} disabled={disabled} {...register('qualityEvidence.blocked', { valueAsNumber: true })} />
                <MetricInput label="Automation" min={0} max={100} suffix="%" error={fieldError(formState, 'qualityEvidence.automationPercent')} disabled={disabled} {...register('qualityEvidence.automationPercent', { valueAsNumber: true })} />
              </div>
              <p className={styles.derivedHints}>
                <span>Execution rate {formatRate(rates.executionRate)}</span>
                <span>Pass rate {formatRate(rates.passRate)}</span>
              </p>
              {inconsistencies.length > 0 && (
                <div className={styles.warning} role="status">
                  {inconsistencies.map((issue) => (
                    <div key={issue}>{METRIC_INCONSISTENCY_MESSAGES[issue]}</div>
                  ))}
                  <TextareaField label="Explain the inconsistency" rows={2} required error={fieldError(formState, 'metricsNote')} disabled={disabled} {...register('metricsNote')} />
                </div>
              )}
            </section>

            <section aria-labelledby="achievements-title">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="achievements-title">Achievements this week</h2>
                  <p>What changed against the weekly commitment?</p>
                </div>
              </div>
              <TextareaField label="Achievements this week" rows={8} required hideLabel error={fieldError(formState, 'achievements')} disabled={disabled} {...register('achievements')} />
            </section>

            <section aria-labelledby="ai-title">
              <div className={styles.sectionHeading}>
                <div>
                  <h2 id="ai-title">AI value</h2>
                  <p>Use case → benefit → validation → next step.</p>
                </div>
              </div>
              <div className={styles.aiFields}>
                <TextField label="Use case" error={fieldError(formState, 'aiValue.useCase')} disabled={disabled} {...register('aiValue.useCase')} />
                <TextField label="Measurable benefit" error={fieldError(formState, 'aiValue.measurableBenefit')} disabled={disabled} {...register('aiValue.measurableBenefit')} />
                <TextField label="Human validation" error={fieldError(formState, 'aiValue.humanValidation')} disabled={disabled} {...register('aiValue.humanValidation')} />
                <TextField label="Next experiment / constraint" error={fieldError(formState, 'aiValue.nextExperimentConstraint')} disabled={disabled} {...register('aiValue.nextExperimentConstraint')} />
              </div>
            </section>
          </div>

          <section className={styles.section} aria-labelledby="exceptions-title">
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="exceptions-title">Risks · Issues · Blockers</h2>
                <p>
                  <strong>Risk</strong> may affect delivery. <strong>Issue</strong> already affects it.{' '}
                  <strong>Blocker</strong> stopped specific work. Resolve items instead of deleting them.
                </p>
              </div>
            </div>
            <Controller
              control={control}
              name="exceptions"
              render={({ field }) => (
                <ExceptionEditor
                  value={field.value}
                  onChange={field.onChange}
                  disabled={disabled}
                  getError={(index, exField) => exceptionError(formState, index, exField)}
                />
              )}
            />
          </section>

          <section className={styles.leadershipAsk} aria-labelledby="ask-title">
            <div>
              <h2 id="ask-title">Leadership ask</h2>
              <p>One decision, escalation or resource required this week.</p>
              <label className={styles.checkboxRow}>
                <input type="checkbox" disabled={disabled} {...register('noLeadershipAsk')} />
                No leadership ask this week
              </label>
            </div>
            <TextareaField
              label="Leadership ask"
              hideLabel
              rows={2}
              placeholder={noAsk ? 'No leadership ask selected' : 'Describe the ask…'}
              error={fieldError(formState, 'leadershipAsk')}
              disabled={disabled || noAsk}
              {...register('leadershipAsk')}
            />
          </section>

          <div className={styles.actionBar}>
            <SaveStateBadge state={saveState} savedAt={savedAt} />
            <div className={styles.actionButtons}>
              <Button type="button" onClick={onManualSave} disabled={disabled || saveState === 'saving'}>
                Save draft
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={disabled || !canSubmitRole || submitUpdate.isPending}
                title={!canSubmitRole ? 'Only a Team Lead can submit an update.' : undefined}
              >
                Submit update
              </Button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

function ConflictPanel({
  conflict,
  onUseServer,
  onKeepMine,
}: {
  conflict: ConflictState;
  onUseServer: () => void;
  onKeepMine: () => void;
}) {
  const changed = conflict.serverDoc
    ? changedFields(conflict.localValues, conflict.serverDoc)
    : [];
  return (
    <section className={styles.conflictPanel} role="alert" aria-labelledby="conflict-title">
      <h2 id="conflict-title">Version conflict — choose how to resolve</h2>
      <p>
        Another session changed this draft after you opened it. Writing is paused. Your unsaved changes
        are kept until you choose.
      </p>
      <div className={styles.conflictCols}>
        <div className={styles.conflictCol}>
          <h3>Your version (unsaved)</h3>
          <p>Kept locally, not written to the server.</p>
        </div>
        <div className={styles.conflictCol}>
          <h3>Server version</h3>
          {conflict.serverDoc ? (
            <p>
              Revision {conflict.serverDoc.revision} · last changed by {conflict.serverDoc.updatedBy} ·{' '}
              {formatTimestamp(conflict.serverDoc.updatedAt)}
            </p>
          ) : (
            <p>Could not load the latest server version.</p>
          )}
        </div>
      </div>
      {changed.length > 0 && (
        <>
          <strong>Fields that differ:</strong>
          <ul className={styles.conflictChanged}>
            {changed.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </>
      )}
      <div className={styles.conflictActions}>
        <Button onClick={onUseServer} disabled={!conflict.serverDoc}>
          Use server version
        </Button>
        <Button variant="primary" onClick={onKeepMine}>
          Keep my version (overwrite)
        </Button>
      </div>
    </section>
  );
}

function SaveStateBadge({ state, savedAt }: { state: SaveState; savedAt: string | null }) {
  const label =
    state === 'saving'
      ? 'Saving draft…'
      : state === 'failed'
        ? 'Save failed — changes kept'
        : state === 'conflict'
          ? 'Version conflict — resolve to continue'
          : savedAt
            ? `Draft saved · ${formatTimestamp(savedAt)}`
            : 'Not saved yet';
  return (
    <span className={styles.saveState}>
      <span
        className={cn(styles.saveDot, state === 'saving' && styles.saving, (state === 'failed' || state === 'conflict') && styles.failed)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function TeamUpdateSkeleton() {
  return (
    <div className={styles.pageHeading} aria-busy="true" aria-label="Loading team update">
      <div style={{ display: 'grid', gap: 'var(--space-sm)', width: '100%' }}>
        <Skeleton width="18rem" height="1rem" />
        <Skeleton width="24rem" height="2rem" />
        <Skeleton width="100%" height="12rem" />
      </div>
    </div>
  );
}

function sprintLabel(sprintId: string): string {
  return sprintId.replace(/^S/, 'Sprint ');
}

function emptyFormValues(): TeamUpdateFormValues {
  return {
    rag: { business: 'GREEN', delivery: 'GREEN', release: 'GREEN' },
    goals: { business: '', technicalTesting: '', sprintCommitment: '', nextWeekCommitment: '' },
    qualityEvidence: { planned: 0, executed: 0, passed: 0, openCritical: 0, blocked: 0, automationPercent: 0 },
    achievements: '',
    aiValue: { useCase: '', measurableBenefit: '', humanValidation: '', nextExperimentConstraint: '' },
    exceptions: [],
    leadershipAsk: '',
    noLeadershipAsk: false,
    statusRationale: '',
    metricsNote: '',
  };
}

/** Human-readable list of sections that differ between local and server. */
function changedFields(local: TeamUpdateFormValues, serverDoc: UpdateDocument): string[] {
  const server = documentToFormValues(serverDoc);
  const diffs: string[] = [];
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!eq(local.rag, server.rag)) diffs.push('RAG statuses');
  if (!eq(local.goals, server.goals)) diffs.push('Goals & commitments');
  if (!eq(local.qualityEvidence, server.qualityEvidence)) diffs.push('Quality evidence');
  if (local.achievements !== server.achievements) diffs.push('Achievements');
  if (!eq(local.aiValue, server.aiValue)) diffs.push('AI value');
  if (!eq(local.exceptions, server.exceptions)) diffs.push('Risks / issues / blockers');
  if (local.leadershipAsk !== server.leadershipAsk || local.noLeadershipAsk !== server.noLeadershipAsk) {
    diffs.push('Leadership ask');
  }
  return diffs;
}

type FormErrors = FieldErrors<TeamUpdateFormValues>;

function messageOf(node: unknown): string | undefined {
  if (node && typeof node === 'object' && 'message' in node) {
    const message = (node as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

function fieldError(formState: { errors: FormErrors }, path: string): string | undefined {
  let node: unknown = formState.errors;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
    if (!node) return undefined;
  }
  return messageOf(node);
}

function exceptionError(
  formState: { errors: FormErrors },
  index: number,
  field: ExceptionField,
): string | undefined {
  return fieldError(formState, `exceptions.${index}.${field}`);
}

function flattenErrors(errors: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (!errors || typeof errors !== 'object') return out;
  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    if (!value) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const message = messageOf(value);
    if (message) {
      out[path] = message;
    } else if (typeof value === 'object') {
      Object.assign(out, flattenErrors(value, path));
    }
  }
  return out;
}

function focusPath(setFocus: UseFormSetFocus<TeamUpdateFormValues>, path: string) {
  // Exception subfields are custom controls — focus them by DOM id.
  const exceptionMatch = path.match(/^exceptions\.(\d+)\.(\w+)$/);
  if (exceptionMatch) {
    const [, index, field] = exceptionMatch;
    const el = document.getElementById(exceptionFieldId(Number(index), field as ExceptionField));
    el?.focus();
    return;
  }
  try {
    setFocus(path as Parameters<typeof setFocus>[0]);
  } catch {
    /* custom controls may not be focusable by name */
  }
}
