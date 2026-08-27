import { cn } from '../lib/cn';
import { RAG_LABELS, type RagValue } from '../domain/update';
import styles from './StatusDot.module.css';

const toneClass: Record<RagValue, string> = {
  GREEN: styles.green,
  AMBER: styles.amber,
  RED: styles.red,
};

export interface StatusDotProps {
  value: RagValue;
  /** Accessible label prefix, e.g. "Business". Colour never carries meaning alone. */
  labelPrefix?: string;
}

/**
 * A RAG dot. Colour NEVER carries meaning alone (R4.2): the accessible name
 * always includes the textual status, and callers should render a visible text
 * label alongside where the dot stands in for status.
 */
export function StatusDot({ value, labelPrefix }: StatusDotProps) {
  const label = labelPrefix ? `${labelPrefix}: ${RAG_LABELS[value]}` : RAG_LABELS[value];
  return (
    <span
      className={cn(styles.dot, toneClass[value])}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
