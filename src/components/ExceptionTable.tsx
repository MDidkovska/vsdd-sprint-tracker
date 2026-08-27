import { cn } from '../lib/cn';
import { formatDueDate } from '../lib/datetime';
import { EXCEPTION_TYPE_LABELS, type ExceptionItem, type ExceptionType } from '../domain/update';
import { InlineEmptyState } from './EmptyState';
import styles from './ExceptionTable.module.css';

const typeClass: Record<ExceptionType, string> = {
  RISK: styles.risk,
  ISSUE: styles.issue,
  BLOCKER: styles.blocker,
};

export interface ExceptionTableProps {
  exceptions: ExceptionItem[];
}

/**
 * Read-only Risk / Issue / Blocker table. Never collapses the three types into
 * one generic warning (R9.5). Reflows into labelled records on small screens.
 */
export function ExceptionTable({ exceptions }: ExceptionTableProps) {
  if (exceptions.length === 0) {
    return (
      <InlineEmptyState
        title="No open exceptions"
        description="The team reported no current risks, issues or blockers for this update."
      />
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={cn(styles.table, styles.readonly)} aria-label="Reported risks, issues and blockers">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Business / release impact</th>
            <th scope="col">Owner</th>
            <th scope="col">Due date</th>
            <th scope="col">Decision / support &amp; resolution</th>
          </tr>
        </thead>
        <tbody>
          {exceptions.map((item) => (
            <tr key={item.id}>
              <td data-label="Type">
                <span className={cn(styles.type, typeClass[item.type])}>
                  {EXCEPTION_TYPE_LABELS[item.type]}
                </span>
              </td>
              <td data-label="Status">
                <span className={item.status === 'RESOLVED' ? styles.statusResolved : styles.statusOpen}>
                  {item.status === 'RESOLVED' ? 'Resolved' : 'Open'}
                </span>
              </td>
              <td data-label="Business / release impact">{item.impact}</td>
              <td data-label="Owner">{item.owner}</td>
              <td data-label="Due date">{formatDueDate(item.dueDate)}</td>
              <td data-label="Decision / support & resolution">
                {item.decisionSupport}
                {item.status === 'RESOLVED' && (
                  <span className={styles.resolutionInfo}>
                    Resolved {item.resolvedAt ? formatDueDate(item.resolvedAt) : '—'}
                    {item.resolutionNote ? ` — ${item.resolutionNote}` : ''}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
