import { useId } from 'react';
import { cn } from '../lib/cn';
import { RAG_LABELS, type RagValue } from '../domain/update';
import styles from './RagSelector.module.css';

const OPTIONS: RagValue[] = ['GREEN', 'AMBER', 'RED'];
const toneClass: Record<RagValue, string> = {
  GREEN: styles.green,
  AMBER: styles.amber,
  RED: styles.red,
};

export interface RagSelectorProps {
  /** Unique radio group name. */
  name: string;
  /** Visible label above the control. */
  label: string;
  value: RagValue;
  onChange: (value: RagValue) => void;
  disabled?: boolean;
}

/**
 * A semantic RAG radio group. Each option always renders text with the colour
 * dot (R4.2 — colour never carries meaning alone). Native radios provide the
 * expected arrow-key roving behaviour within the group.
 */
export function RagSelector({ name, label, value, onChange, disabled }: RagSelectorProps) {
  const groupId = useId();
  return (
    <div className={styles.field}>
      <span className={styles.label} id={`${groupId}-label`}>
        {label}
      </span>
      <div className={styles.control} role="radiogroup" aria-labelledby={`${groupId}-label`}>
        {OPTIONS.map((option) => {
          const optionId = `${groupId}-${option.toLowerCase()}`;
          return (
            <span key={option} className={cn(styles.option, toneClass[option])}>
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(option)}
              />
              <label htmlFor={optionId}>
                <span className={styles.dot} aria-hidden="true" />
                {RAG_LABELS[option]}
              </label>
            </span>
          );
        })}
      </div>
    </div>
  );
}
