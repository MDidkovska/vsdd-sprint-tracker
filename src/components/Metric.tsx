import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import styles from './Metric.module.css';

export type MetricTone = 'default' | 'alert' | 'positive' | 'info';

export interface MetricInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: string;
  error?: string;
  suffix?: string;
  id?: string;
}

/** Compact numeric input with tabular figures and an optional suffix (e.g. %). */
export const MetricInput = forwardRef<HTMLInputElement, MetricInputProps>(function MetricInput(
  { label, error, suffix, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const input = (
    <input
      ref={ref}
      id={fieldId}
      type="number"
      inputMode="numeric"
      className={cn(styles.input, error && styles.invalid, className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      {...rest}
    />
  );
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      {suffix ? (
        <div className={styles.suffixWrap}>
          {input}
          <span className={styles.suffix} aria-hidden="true">
            {suffix}
          </span>
        </div>
      ) : (
        input
      )}
      {error && (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

export interface ReadOnlyMetricProps {
  label: string;
  value: string | number;
  tone?: MetricTone;
}

const toneClass: Record<MetricTone, string | undefined> = {
  default: undefined,
  alert: styles.alert,
  positive: styles.positive,
  info: styles.info,
};

/** Read-only metric readout used in Leadership View. */
export function ReadOnlyMetric({ label, value, tone = 'default' }: ReadOnlyMetricProps) {
  return (
    <div className={styles.readout}>
      <span className={styles.readoutLabel}>{label}</span>
      <strong className={cn(styles.readoutValue, toneClass[tone])}>{value}</strong>
    </div>
  );
}
