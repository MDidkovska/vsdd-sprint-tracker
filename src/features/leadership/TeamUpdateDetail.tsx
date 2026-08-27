import { useState } from 'react';
import { cn } from '../../lib/cn';
import { relativeFromNow } from '../../lib/datetime';
import {
  RAG_LABELS,
  STATE_LABELS,
  type LeadershipCellState,
  type RagValue,
} from '../../domain/update';
import { calculateDerivedRates, formatRate } from '../../domain/derived';
import type { LeadershipTeamCell } from '../../domain/leadership';
import type { LeadershipDecision } from '../../domain/update';
import { StatusDot } from '../../components/StatusDot';
import { StatusChip } from '../../components/StatusChip';
import { ReadOnlyMetric } from '../../components/Metric';
import { ExceptionTable } from '../../components/ExceptionTable';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import styles from './Leadership.module.css';

const ragClass: Record<RagValue, string> = {
  GREEN: styles.ragGreen,
  AMBER: styles.ragAmber,
  RED: styles.ragRed,
};

export interface TeamUpdateDetailProps {
  cell: LeadershipTeamCell;
  sprintLabel: string;
  weekNumber: 1 | 2;
  canDecide: boolean;
  decisions: LeadershipDecision[];
  onRecordDecision: (decision: string, dueDate?: string) => void;
  /**
   * The reporting checkpoint of the selected week. When provided together with
   * {@link onSelectVersion}, the read-only version-history panel (task 9.4) is
   * rendered for submitted evidence. Optional so the detail can still be shown
   * in isolation.
   */
  checkpointId?: string;
  /** The version anchored in the deep link (task 9.3), if any. */
  selectedVersionId?: string;
  /** Persist an opened historical version into the deep link (task 9.4). */
  onSelectVersion?: (versionId: string) => void;
}

export function TeamUpdateDetail({
  cell,
  sprintLabel,
  weekNumber,
  canDecide,
  decisions,
  onRecordDecision,
  checkpointId,
  selectedVersionId,
  onSelectVersion,
}: TeamUpdateDetailProps) {
  const { team, resolved } = cell;

  if (resolved.cellState === 'MISSING' || !resolved.payload || !resolved.rag) {
    return (
      <div className={styles.detail}>
        <p className={styles.detailBreadcrumb}>
          {cell.streamId} / {team.name} / {sprintLabel} / Week {weekNumber}
        </p>
        <EmptyState
          title="No current evidence for this checkpoint"
          description="This team has no draft or submission for the selected sprint and week. There is no RAG status to show — this is not submitted leadership evidence."
        />
      </div>
    );
  }

  const p = resolved.payload;
  const rag = resolved.rag;
  const rates = calculateDerivedRates(p.qualityEvidence);
  const achievements = splitLines(p.achievements);
  const aiItems = [
    `Use case — ${orNotReported(p.aiValue.useCase)}`,
    `Measurable benefit — ${orNotReported(p.aiValue.measurableBenefit)}`,
    `Human validation — ${orNotReported(p.aiValue.humanValidation)}`,
    `Next / constraint — ${orNotReported(p.aiValue.nextExperimentConstraint)}`,
  ];

  return (
    <article className={styles.detail} aria-live="polite">
      <p className={styles.detailBreadcrumb}>
        {cell.streamId} / {team.name} / {sprintLabel} / Week {weekNumber}
      </p>
      <div className={styles.detailTitleRow}>
        <h2>{team.name}</h2>
        <StatusChip
          state={resolved.cellState as LeadershipCellState}
          suffix={resolved.submittedAt ? `· ${relativeFromNow(resolved.submittedAt)}` : undefined}
        />
      </div>

      {resolved.isStale && (
        <p className={styles.staleNotice} role="status">
          {STATE_LABELS.STALE}: showing the latest submission from Week {resolved.sourceWeekNumber}. There
          is no submitted version for the selected checkpoint, so this does not count as current evidence.
        </p>
      )}

      <div className={styles.ragGrid} aria-label="Current team status">
        <RagBlock label="Business outcome" value={rag.business} />
        <RagBlock label="Test delivery" value={rag.delivery} />
        <RagBlock label="Release confidence" value={rag.release} />
      </div>

      {(p.statusRationale?.trim() || p.metricsNote?.trim()) && (
        <section className={styles.detailSection} aria-label="Status notes">
          {p.statusRationale?.trim() && (
            <p>
              <span className={styles.goalLabel}>Status rationale</span>
              {p.statusRationale}
            </p>
          )}
          {p.metricsNote?.trim() && (
            <p>
              <span className={styles.goalLabel}>Metric inconsistency note</span>
              {p.metricsNote}
            </p>
          )}
        </section>
      )}

      <section className={styles.detailSection} aria-labelledby="d-goals">
        <h3 id="d-goals">Goals &amp; commitments</h3>
        <div className={styles.goals}>
          <GoalRead label="Business goal" value={p.goals.business} />
          <GoalRead label="Technical / testing goal" value={p.goals.technicalTesting} />
          <GoalRead label="Sprint commitment" value={p.goals.sprintCommitment} />
          <GoalRead label="Next week commitment" value={p.goals.nextWeekCommitment} />
        </div>
      </section>

      <section className={styles.detailSection} aria-labelledby="d-quality">
        <h3 id="d-quality">Quality evidence</h3>
        <div className={styles.qualityRead}>
          <ReadOnlyMetric label="Planned" value={p.qualityEvidence.planned} />
          <ReadOnlyMetric label="Executed" value={p.qualityEvidence.executed} />
          <ReadOnlyMetric label="Passed" value={p.qualityEvidence.passed} tone="positive" />
          <ReadOnlyMetric label="Open critical" value={p.qualityEvidence.openCritical} tone={p.qualityEvidence.openCritical ? 'alert' : 'default'} />
          <ReadOnlyMetric label="Blocked" value={p.qualityEvidence.blocked} tone={p.qualityEvidence.blocked ? 'alert' : 'default'} />
          <ReadOnlyMetric label="Automation" value={`${p.qualityEvidence.automationPercent}%`} tone="info" />
        </div>
        <p className={styles.detailBreadcrumb} style={{ marginTop: 'var(--space-sm)', marginBottom: 0 }}>
          Execution rate {formatRate(rates.executionRate)} · Pass rate {formatRate(rates.passRate)} (derived)
        </p>
      </section>

      <div className={styles.split}>
        <section aria-labelledby="d-week">
          <h3 id="d-week">Week trajectory</h3>
          <ul>
            {(achievements.length ? achievements : ['No weekly achievements reported.']).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="d-ai">
          <h3 id="d-ai">AI value</h3>
          <ul>
            {aiItems.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className={styles.detailSection} aria-labelledby="d-exceptions">
        <h3 id="d-exceptions">Risks · Issues · Blockers</h3>
        <ExceptionTable exceptions={p.exceptions} />
      </section>

      <section className={styles.askRead} aria-labelledby="d-ask">
        <h3 id="d-ask">Leadership ask</h3>
        <div>
          <p>{p.leadershipAsk || 'None'}</p>
          <LeadershipDecisionArea
            canDecide={canDecide}
            decisions={decisions}
            onRecordDecision={onRecordDecision}
          />
        </div>
      </section>

      {resolved.isSubmittedEvidence && checkpointId && onSelectVersion && (
        <VersionHistoryPanel
          teamId={team.id}
          checkpointId={checkpointId}
          selectedVersionId={selectedVersionId}
          onSelectVersion={onSelectVersion}
        />
      )}
    </article>
  );
}

function LeadershipDecisionArea({
  canDecide,
  decisions,
  onRecordDecision,
}: {
  canDecide: boolean;
  decisions: LeadershipDecision[];
  onRecordDecision: (decision: string, dueDate?: string) => void;
}) {
  const [decision, setDecision] = useState('');
  const [dueDate, setDueDate] = useState('');

  return (
    <div className={styles.decisionArea}>
      <h4>Leadership decision</h4>
      {decisions.length > 0 && (
        <ul className={styles.decisionList}>
          {decisions.map((d) => (
            <li key={d.id}>
              {d.decision}
              {d.dueDate ? ` (due ${d.dueDate})` : ''}
            </li>
          ))}
        </ul>
      )}
      {canDecide ? (
        <div className={styles.decisionRow}>
          <TextField
            label="Record a decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
            placeholder="e.g. Approved stage access; owner assigned"
          />
          <TextField label="Due (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Button
            disabled={!decision.trim()}
            onClick={() => {
              onRecordDecision(decision.trim(), dueDate || undefined);
              setDecision('');
              setDueDate('');
            }}
          >
            Record
          </Button>
        </div>
      ) : (
        <p className={styles.detailBreadcrumb} style={{ margin: 0 }}>
          Decisions can be recorded against submitted evidence only.
        </p>
      )}
    </div>
  );
}

function RagBlock({ label, value }: { label: string; value: RagValue }) {
  return (
    <div className={styles.ragItem}>
      <span className={styles.ragItemLabel}>{label}</span>
      <span className={cn(styles.ragItemValue, ragClass[value])}>
        <StatusDot value={value} labelPrefix={label} />
        {RAG_LABELS[value]}
      </span>
    </div>
  );
}

function GoalRead({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.goalRead}>
      <span className={styles.goalLabel}>{label}</span>
      <p>{value || 'Not reported'}</p>
    </div>
  );
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function orNotReported(value: string): string {
  return value.trim() ? value : 'Not reported';
}
