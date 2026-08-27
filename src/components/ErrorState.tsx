import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import styles from './States.module.css';

export interface ErrorStateProps {
  title: string;
  description?: ReactNode;
  correlationId?: string;
  action?: ReactNode;
}

/**
 * A full-block error state. Copy explains what happened and the next action —
 * never a raw stack trace or a generic "Something went wrong" (design.md §6).
 */
export function ErrorState({ title, description, correlationId, action }: ErrorStateProps) {
  return (
    <div className={styles.stateBlock} role="alert">
      <div className={styles.stateInner}>
        <h2 className={cn(styles.stateTitle, styles.errorTitle)}>{title}</h2>
        {description && <p className={styles.stateBody}>{description}</p>}
        {action}
        {correlationId && (
          <p className={styles.stateBody}>
            <small>Reference: {correlationId}</small>
          </p>
        )}
      </div>
    </div>
  );
}
