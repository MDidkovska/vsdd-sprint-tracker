import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';
import styles from './Field.module.css';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Visually hide the label while keeping it accessible. */
  hideLabel?: boolean;
  /** Optional visible character counter, e.g. "128 / 4000". */
  counter?: string;
  children: (aria: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Field shell: visible label (never a placeholder as the only label),
 * optional hint, and an error message wired via aria-describedby +
 * aria-invalid so screen readers announce validation state.
 */
function FieldShell({ id, label, hint, error, required, hideLabel, counter, children }: FieldShellProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={hideLabel ? 'sr-only' : styles.label} htmlFor={id}>
        {label}
        {required && !hideLabel && (
          <span className={styles.requiredMark} aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {counter && (
        <span className={styles.hint}>
          <span className={styles.counter}>{counter}</span>
        </span>
      )}
      {hint && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className={styles.error} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export interface TextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
  counter?: string;
  hideLabel?: boolean;
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField({ label, hint, error, id, required, counter, hideLabel, className, ...rest }, ref) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell
        id={fieldId}
        label={label}
        hint={hint}
        error={error}
        required={required}
        hideLabel={hideLabel}
        counter={counter}
      >
        {({ describedBy, invalid }) => (
          <textarea
            ref={ref}
            id={fieldId}
            className={cn(styles.control, invalid && styles.invalid, className)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-required={required || undefined}
            {...rest}
          />
        )}
      </FieldShell>
    );
  },
);

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
  hideLabel?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, required, hideLabel, className, type, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel}>
      {({ describedBy, invalid }) => (
        <input
          ref={ref}
          id={fieldId}
          type={type ?? 'text'}
          className={cn(styles.control, invalid && styles.invalid, className)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
});

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  id?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, id, required, className, children, ...rest },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      {({ describedBy, invalid }) => (
        <select
          ref={ref}
          id={fieldId}
          className={cn(styles.control, invalid && styles.invalid, className)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
});
