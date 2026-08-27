import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', small = false, block = false, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Always set an explicit type; forms default to "submit" which is a common bug.
      type={type ?? 'button'}
      className={cn(
        styles.button,
        styles[variant],
        small && styles.small,
        block && styles.block,
        className,
      )}
      {...rest}
    />
  );
});
