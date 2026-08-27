import type { ReactNode } from 'react';
import styles from './States.module.css';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** A full-block empty state with an optional recovery action. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.stateBlock}>
      <div className={styles.stateInner}>
        <h2 className={styles.stateTitle}>{title}</h2>
        {description && <p className={styles.stateBody}>{description}</p>}
        {action}
      </div>
    </div>
  );
}

/** A compact inline empty state for use inside a section. */
export function InlineEmptyState({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className={styles.inlineEmpty}>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
