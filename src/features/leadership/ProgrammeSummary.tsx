import type { ProgrammeSummary as Summary } from '../../domain/leadership';
import styles from './Leadership.module.css';

export function ProgrammeSummary({ summary }: { summary: Summary }) {
  return (
    <>
      <div className={styles.summary} aria-label="Programme reporting summary">
        <div>
          <strong>{summary.teamCount}</strong>
          <span>teams</span>
        </div>
        <div>
          <strong>{summary.submittedCount}</strong>
          <span>submitted</span>
        </div>
        <div>
          <strong>{summary.draftOrMissingCount}</strong>
          <span>draft / missing</span>
        </div>
        <div>
          <strong>{summary.leadershipAskCount}</strong>
          <span>leadership asks</span>
        </div>
      </div>
      <p className={styles.reportingPeriod}>Reporting period: {summary.reportingPeriodLabel}</p>
    </>
  );
}
