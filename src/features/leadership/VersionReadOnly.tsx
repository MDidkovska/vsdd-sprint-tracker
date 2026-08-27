import { RAG_LABELS, type RagValue, type UpdateVersion } from '../../domain/update';
import { calculateDerivedRates, formatRate } from '../../domain/derived';
import { formatTimestamp } from '../../lib/datetime';
import { ReadOnlyMetric } from '../../components/Metric';
import { ExceptionTable } from '../../components/ExceptionTable';
import { StatusDot } from '../../components/StatusDot';
import styles from './VersionHistory.module.css';

export interface VersionReadOnlyProps {
  version: UpdateVersion;
}

/**
 * A read-only render of a single immutable submitted version (task 9.4). Used to
 * open any historical version without any edit affordances. Free-text values are
 * shown with their line breaks preserved and numeric zeros rendered literally.
 *
 * It intentionally uses plain (non-landmark) containers so it does not introduce
 * duplicate ARIA regions alongside the surrounding Leadership detail.
 */
export function VersionReadOnly({ version }: VersionReadOnlyProps) {
  const p = version.payload;
  const rag = version.rag;
  const rates = calculateDerivedRates(p.qualityEvidence);

  return (
    <div
      className={styles.versionView}
      role="group"
      aria-label={`Version ${version.versionNumber} details`}
    >
      <p className={styles.rowSub}>
        Version {version.versionNumber} · submitted by {version.submittedBy} ·{' '}
        {formatTimestamp(version.submittedAt)}
      </p>

      <div className={styles.section}>
        <span className={styles.fieldLabel}>RAG status</span>
        <div className={styles.ragRow}>
          <RagRead label="Business outcome" value={rag.business} />
          <RagRead label="Test delivery" value={rag.delivery} />
          <RagRead label="Release confidence" value={rag.release} />
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.fieldLabel}>Goals &amp; commitments</span>
        <FieldRead label="Business goal" value={p.goals.business} />
        <FieldRead label="Technical / testing goal" value={p.goals.technicalTesting} />
        <FieldRead label="Sprint commitment" value={p.goals.sprintCommitment} />
        <FieldRead label="Next week commitment" value={p.goals.nextWeekCommitment} />
      </div>

      <div className={styles.section}>
        <span className={styles.fieldLabel}>Quality evidence</span>
        <div className={styles.metricRow}>
          <ReadOnlyMetric label="Planned" value={p.qualityEvidence.planned} />
          <ReadOnlyMetric label="Executed" value={p.qualityEvidence.executed} />
          <ReadOnlyMetric label="Passed" value={p.qualityEvidence.passed} />
          <ReadOnlyMetric label="Open critical" value={p.qualityEvidence.openCritical} />
          <ReadOnlyMetric label="Blocked" value={p.qualityEvidence.blocked} />
          <ReadOnlyMetric label="Automation" value={`${p.qualityEvidence.automationPercent}%`} />
        </div>
        <p className={styles.rowSub}>
          Execution rate {formatRate(rates.executionRate)} · Pass rate {formatRate(rates.passRate)}{' '}
          (derived)
        </p>
      </div>

      <div className={styles.section}>
        <FieldRead label="Achievements this week" value={p.achievements} />
      </div>

      <div className={styles.section}>
        <span className={styles.fieldLabel}>AI value</span>
        <FieldRead label="Use case" value={p.aiValue.useCase} />
        <FieldRead label="Measurable benefit" value={p.aiValue.measurableBenefit} />
        <FieldRead label="Human validation" value={p.aiValue.humanValidation} />
        <FieldRead label="Next experiment / constraint" value={p.aiValue.nextExperimentConstraint} />
      </div>

      {(p.statusRationale?.trim() || p.metricsNote?.trim()) && (
        <div className={styles.section}>
          {p.statusRationale?.trim() && (
            <FieldRead label="Status rationale" value={p.statusRationale} />
          )}
          {p.metricsNote?.trim() && (
            <FieldRead label="Metric inconsistency note" value={p.metricsNote} />
          )}
        </div>
      )}

      <div className={styles.section}>
        <span className={styles.fieldLabel}>Risks · Issues · Blockers</span>
        <ExceptionTable exceptions={p.exceptions} />
      </div>

      <div className={styles.section}>
        <FieldRead label="Leadership ask" value={p.leadershipAsk || 'None'} />
      </div>
    </div>
  );
}

function RagRead({ label, value }: { label: string; value: RagValue }) {
  return (
    <span>
      <StatusDot value={value} labelPrefix={label} /> {label}: {RAG_LABELS[value]}
    </span>
  );
}

function FieldRead({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.section} style={{ marginTop: 'var(--space-2xs)' }}>
      <span className={styles.fieldLabel}>{label}</span>
      <p className={styles.multiline}>{value.trim() ? value : 'Not reported'}</p>
    </div>
  );
}
