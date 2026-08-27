import { useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { createId } from '../lib/id';
import {
  EXCEPTION_TYPE_LABELS,
  type ExceptionItem,
  type ExceptionStatus,
  type ExceptionType,
} from '../domain/update';
import { Button } from './Button';
import styles from './ExceptionTable.module.css';

const TYPES: ExceptionType[] = ['RISK', 'ISSUE', 'BLOCKER'];

export type ExceptionField =
  | 'impact'
  | 'owner'
  | 'dueDate'
  | 'decisionSupport'
  | 'resolvedAt'
  | 'resolutionNote';

/** Stable DOM id for an exception field (used by the error-summary focus links). */
export function exceptionFieldId(index: number, field: ExceptionField): string {
  return `exception-${index}-${field}`;
}

export interface ExceptionEditorProps {
  value: ExceptionItem[];
  onChange: (next: ExceptionItem[]) => void;
  getError?: (index: number, field: ExceptionField) => string | undefined;
  disabled?: boolean;
}

function newException(): ExceptionItem {
  return {
    id: createId('ex'),
    type: 'RISK',
    impact: '',
    owner: '',
    dueDate: '',
    decisionSupport: '',
    status: 'OPEN',
    resolvedAt: '',
    resolutionNote: '',
  };
}

/**
 * Editable Risk / Issue / Blocker table with the full OPEN/RESOLVED lifecycle.
 * Resolving preserves the item and requires a resolution date + note. Rows are
 * keyed by stable id; errors are linked to their control via aria-describedby.
 */
export function ExceptionEditor({ value, onChange, getError, disabled }: ExceptionEditorProps) {
  const [lastDeleted, setLastDeleted] = useState<{ item: ExceptionItem; index: number } | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  function update(index: number, patch: Partial<ExceptionItem>) {
    onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function setStatus(index: number, status: ExceptionStatus) {
    // Preserve the item; clear resolution fields when reopening.
    update(index, status === 'OPEN' ? { status, resolvedAt: '', resolutionNote: '' } : { status });
  }

  function addItem() {
    onChange([...value, newException()]);
    requestAnimationFrame(() => {
      const selects = bodyRef.current?.querySelectorAll<HTMLSelectElement>('select');
      selects?.[selects.length - 1]?.focus();
    });
  }

  function removeItem(index: number) {
    const item = value[index];
    if (!item) return;
    setLastDeleted({ item, index });
    onChange(value.filter((_, i) => i !== index));
  }

  function undoRemove() {
    if (!lastDeleted) return;
    const next = [...value];
    next.splice(Math.min(lastDeleted.index, value.length), 0, lastDeleted.item);
    onChange(next);
    setLastDeleted(null);
  }

  function describedBy(index: number, field: ExceptionField): string | undefined {
    return getError?.(index, field) ? `${exceptionFieldId(index, field)}-error` : undefined;
  }

  return (
    <div>
      <div className={styles.tableWrap}>
        <table className={cn(styles.table, styles.editable)} aria-label="Edit risks, issues and blockers">
          <thead>
            <tr>
              <th scope="col">Type &amp; status</th>
              <th scope="col">Business / release impact</th>
              <th scope="col">Owner</th>
              <th scope="col">Due date</th>
              <th scope="col">Decision / support &amp; resolution</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {value.length === 0 ? (
              <tr className={styles.emptyRow}>
                <td colSpan={6}>
                  No open risks, issues or blockers. Add an item if an exception needs action.
                </td>
              </tr>
            ) : (
              value.map((item, index) => {
                const impactError = getError?.(index, 'impact');
                const ownerError = getError?.(index, 'owner');
                const dueError = getError?.(index, 'dueDate');
                const decisionError = getError?.(index, 'decisionSupport');
                const resolvedAtError = getError?.(index, 'resolvedAt');
                const resolutionNoteError = getError?.(index, 'resolutionNote');
                const resolved = item.status === 'RESOLVED';
                return (
                  <tr key={item.id} className={resolved ? styles.resolvedRow : undefined}>
                    <td data-label="Type & status">
                      <select
                        id={exceptionFieldId(index, 'impact').replace('impact', 'type')}
                        className={styles.select}
                        aria-label={`Exception ${index + 1} type`}
                        value={item.type}
                        disabled={disabled}
                        onChange={(e) => update(index, { type: e.target.value as ExceptionType })}
                      >
                        {TYPES.map((type) => (
                          <option key={type} value={type}>
                            {EXCEPTION_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                      <select
                        className={cn(styles.select, styles.statusSelect)}
                        aria-label={`Exception ${index + 1} status`}
                        value={item.status}
                        disabled={disabled}
                        onChange={(e) => setStatus(index, e.target.value as ExceptionStatus)}
                      >
                        <option value="OPEN">Open</option>
                        <option value="RESOLVED">Resolved</option>
                      </select>
                    </td>
                    <td data-label="Business / release impact">
                      <textarea
                        id={exceptionFieldId(index, 'impact')}
                        className={cn(styles.input, styles.textarea, impactError && styles.invalid)}
                        rows={2}
                        aria-label={`Exception ${index + 1} business or release impact`}
                        aria-invalid={impactError ? true : undefined}
                        aria-describedby={describedBy(index, 'impact')}
                        value={item.impact}
                        disabled={disabled}
                        onChange={(e) => update(index, { impact: e.target.value })}
                      />
                      {impactError && (
                        <span className={styles.cellError} id={`${exceptionFieldId(index, 'impact')}-error`}>
                          {impactError}
                        </span>
                      )}
                    </td>
                    <td data-label="Owner">
                      <input
                        id={exceptionFieldId(index, 'owner')}
                        className={cn(styles.input, ownerError && styles.invalid)}
                        type="text"
                        aria-label={`Exception ${index + 1} owner`}
                        aria-invalid={ownerError ? true : undefined}
                        aria-describedby={describedBy(index, 'owner')}
                        value={item.owner}
                        disabled={disabled}
                        onChange={(e) => update(index, { owner: e.target.value })}
                      />
                      {ownerError && (
                        <span className={styles.cellError} id={`${exceptionFieldId(index, 'owner')}-error`}>
                          {ownerError}
                        </span>
                      )}
                    </td>
                    <td data-label="Due date">
                      <input
                        id={exceptionFieldId(index, 'dueDate')}
                        className={cn(styles.input, dueError && styles.invalid)}
                        type="date"
                        aria-label={`Exception ${index + 1} due date`}
                        aria-invalid={dueError ? true : undefined}
                        aria-describedby={describedBy(index, 'dueDate')}
                        value={item.dueDate}
                        disabled={disabled}
                        onChange={(e) => update(index, { dueDate: e.target.value })}
                      />
                      {dueError && (
                        <span className={styles.cellError} id={`${exceptionFieldId(index, 'dueDate')}-error`}>
                          {dueError}
                        </span>
                      )}
                    </td>
                    <td data-label="Decision / support & resolution">
                      <textarea
                        id={exceptionFieldId(index, 'decisionSupport')}
                        className={cn(styles.input, styles.textarea, decisionError && styles.invalid)}
                        rows={2}
                        aria-label={`Exception ${index + 1} decision or support needed`}
                        aria-invalid={decisionError ? true : undefined}
                        aria-describedby={describedBy(index, 'decisionSupport')}
                        value={item.decisionSupport}
                        disabled={disabled}
                        onChange={(e) => update(index, { decisionSupport: e.target.value })}
                      />
                      {decisionError && (
                        <span className={styles.cellError} id={`${exceptionFieldId(index, 'decisionSupport')}-error`}>
                          {decisionError}
                        </span>
                      )}
                      {resolved && (
                        <div className={styles.resolutionFields}>
                          <label className={styles.resolutionLabel} htmlFor={exceptionFieldId(index, 'resolvedAt')}>
                            Resolution date
                          </label>
                          <input
                            id={exceptionFieldId(index, 'resolvedAt')}
                            className={cn(styles.input, resolvedAtError && styles.invalid)}
                            type="date"
                            aria-invalid={resolvedAtError ? true : undefined}
                            aria-describedby={describedBy(index, 'resolvedAt')}
                            value={item.resolvedAt ?? ''}
                            disabled={disabled}
                            onChange={(e) => update(index, { resolvedAt: e.target.value })}
                          />
                          {resolvedAtError && (
                            <span className={styles.cellError} id={`${exceptionFieldId(index, 'resolvedAt')}-error`}>
                              {resolvedAtError}
                            </span>
                          )}
                          <label className={styles.resolutionLabel} htmlFor={exceptionFieldId(index, 'resolutionNote')}>
                            Resolution note
                          </label>
                          <textarea
                            id={exceptionFieldId(index, 'resolutionNote')}
                            className={cn(styles.input, styles.textarea, resolutionNoteError && styles.invalid)}
                            rows={2}
                            aria-invalid={resolutionNoteError ? true : undefined}
                            aria-describedby={describedBy(index, 'resolutionNote')}
                            value={item.resolutionNote ?? ''}
                            disabled={disabled}
                            onChange={(e) => update(index, { resolutionNote: e.target.value })}
                          />
                          {resolutionNoteError && (
                            <span className={styles.cellError} id={`${exceptionFieldId(index, 'resolutionNote')}-error`}>
                              {resolutionNoteError}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td data-label="Actions">
                      <button
                        type="button"
                        className={styles.deleteRow}
                        aria-label={`Delete ${EXCEPTION_TYPE_LABELS[item.type].toLowerCase()} ${index + 1}`}
                        disabled={disabled}
                        onClick={() => removeItem(index)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {lastDeleted && (
        <div className={styles.undoBar} role="status">
          <span>{EXCEPTION_TYPE_LABELS[lastDeleted.item.type]} removed from this draft.</span>
          <Button small onClick={undoRemove}>
            Undo
          </Button>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-sm)' }}>
        <Button small onClick={addItem} disabled={disabled}>
          + Add item
        </Button>
      </div>
    </div>
  );
}
