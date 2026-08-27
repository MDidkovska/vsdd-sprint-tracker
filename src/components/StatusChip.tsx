import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { STATE_LABELS, type LeadershipCellState } from '../domain/update';
import styles from './StatusChip.module.css';

const toneClass: Record<LeadershipCellState, string> = {
  SUBMITTED: styles.submitted,
  DRAFT: styles.draft,
  REOPENED: styles.reopened,
  STALE: styles.stale,
  MISSING: styles.missing,
};

export interface StatusChipProps {
  state: LeadershipCellState;
  /** Extra text after the state label, e.g. "· updated 2 h ago". */
  suffix?: ReactNode;
}

/** A labelled chip for an update state. The text label is always present. */
export function StatusChip({ state, suffix }: StatusChipProps) {
  return (
    <span className={cn(styles.chip, toneClass[state])}>
      {STATE_LABELS[state]}
      {suffix ? <span> {suffix}</span> : null}
    </span>
  );
}
