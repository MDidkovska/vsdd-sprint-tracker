import { formatTimestamp } from '../../lib/datetime';
import { InlineEmptyState } from '../../components/EmptyState';
import { EXCEPTION_TYPE_LABELS } from '../../domain/update';
import {
  COMPARISON_SECTION_ORDER,
  sectionForPath,
  type ComparableValue,
  type ExceptionComparison,
  type FieldComparison,
  type VersionComparison,
} from '../../domain/versionComparison';
import styles from './VersionHistory.module.css';

export interface VersionCompareProps {
  comparison: VersionComparison;
}

type ChangeKind = 'added' | 'removed' | 'changed';

const CHANGE_TAG_CLASS: Record<ChangeKind, string> = {
  added: styles.tagAdded,
  removed: styles.tagRemoved,
  changed: styles.tagChanged,
};

const CHANGE_TAG_LABEL: Record<ChangeKind, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

const EXCEPTION_CHANGE_LABEL: Record<ExceptionComparison['changeType'], string> = {
  ADDED: 'Added',
  REMOVED: 'Removed',
  MODIFIED: 'Changed',
  UNCHANGED: 'Unchanged',
};

/**
 * Field-level comparison view (task 9.4). Groups every changed value by section
 * (RAG, goals, quality evidence, achievements, AI value, status notes, exceptions
 * and the Leadership ask) and marks each as added, removed or changed. It is
 * NOT a raw JSON diff: values are rendered as human-readable text with line
 * breaks preserved and numeric zeros shown literally. Exceptions are matched by
 * their stable id.
 */
export function VersionCompare({ comparison }: VersionCompareProps) {
  const { previous, current, fields, exceptions, hasChanges } = comparison;

  const changedFields = fields.filter((f) => f.changed);
  const changedExceptions = exceptions.filter((e) => e.changeType !== 'UNCHANGED');

  return (
    <div role="group" aria-label="Version comparison">
      <p className={styles.compareHeader}>
        <span>
          Version {previous.versionNumber}
          <span className={styles.rowSub}>
            {' '}
            · {previous.submittedBy} · {formatTimestamp(previous.submittedAt)}
          </span>
        </span>
        <span className={styles.compareArrow} aria-hidden="true">
          →
        </span>
        <span>
          Version {current.versionNumber}
          <span className={styles.rowSub}>
            {' '}
            · {current.submittedBy} · {formatTimestamp(current.submittedAt)}
          </span>
        </span>
      </p>

      {!hasChanges ? (
        <InlineEmptyState
          title="No differences"
          description="These two versions are identical across every field and exception."
        />
      ) : (
        <>
          {COMPARISON_SECTION_ORDER.map((section) => {
            const sectionFields = changedFields.filter((f) => sectionForPath(f.path) === section);
            if (sectionFields.length === 0) return null;
            return (
              <section key={section} className={styles.diffSection}>
                <h4>{section}</h4>
                <FieldDiffTable fields={sectionFields} />
              </section>
            );
          })}

          {changedExceptions.length > 0 && (
            <section className={styles.diffSection}>
              <h4>Risks · Issues · Blockers</h4>
              {changedExceptions.map((exception) => (
                <ExceptionDiff key={exception.id} exception={exception} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FieldDiffTable({ fields }: { fields: FieldComparison[] }) {
  return (
    <table className={styles.diffTable}>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Previous</th>
          <th scope="col">Current</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => {
          const kind = changeKind(field);
          return (
            <tr key={field.path}>
              <th scope="row">{field.label}</th>
              <td className={styles.diffPrev}>{renderValue(field.previous)}</td>
              <td className={styles.diffCurr}>{renderValue(field.current)}</td>
              <td>
                <span className={`${styles.changeTag} ${CHANGE_TAG_CLASS[kind]}`}>
                  {CHANGE_TAG_LABEL[kind]}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExceptionDiff({ exception }: { exception: ExceptionComparison }) {
  const changedFields = exception.fields.filter((f) => f.changed);
  const changeLabel = EXCEPTION_CHANGE_LABEL[exception.changeType];
  const tagClass =
    exception.changeType === 'ADDED'
      ? styles.tagAdded
      : exception.changeType === 'REMOVED'
        ? styles.tagRemoved
        : styles.tagChanged;

  // For added/removed lines show every field (they are all new/gone); for a
  // modified line show only the fields that actually changed.
  const rows =
    exception.changeType === 'MODIFIED'
      ? changedFields
      : exception.fields.filter((f) => f.previous !== null || f.current !== null);

  return (
    <div className={styles.exceptionDiff}>
      <p className={styles.exceptionDiffHead}>
        <span>{exceptionTitle(exception)}</span>
        <span className={`${styles.changeTag} ${tagClass}`}>{changeLabel}</span>
      </p>
      <FieldDiffTable fields={rows} />
    </div>
  );
}

/** A readable title for an exception line using its type when available. */
function exceptionTitle(exception: ExceptionComparison): string {
  const typeField = exception.fields.find((f) => f.path === 'type');
  const type = (exception.changeType === 'REMOVED' ? typeField?.previous : typeField?.current) as
    | keyof typeof EXCEPTION_TYPE_LABELS
    | null;
  const label = type ? EXCEPTION_TYPE_LABELS[type] : 'Exception';
  return `${label} (id ${exception.id})`;
}

function changeKind(field: FieldComparison): ChangeKind {
  const prevEmpty = field.previous === null || field.previous === '';
  const currEmpty = field.current === null || field.current === '';
  if (prevEmpty && !currEmpty) return 'added';
  if (!prevEmpty && currEmpty) return 'removed';
  return 'changed';
}

/**
 * Render a comparable value for display. `null` (absent) shows an em dash; a
 * numeric value — including 0 — is rendered literally; strings keep their line
 * breaks via the surrounding `pre-wrap` cell.
 */
function renderValue(value: ComparableValue) {
  if (value === null) return <span className={styles.absent}>—</span>;
  if (typeof value === 'number') return String(value);
  if (value === '') return <span className={styles.absent}>—</span>;
  return value;
}
