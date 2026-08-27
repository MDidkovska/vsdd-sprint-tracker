import type { CSSProperties } from 'react';
import styles from './States.module.css';

export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
  'aria-label'?: string;
}

/** A shimmering placeholder for loading content. Decorative by default. */
export function Skeleton({ width = '100%', height = '1rem', radius, className, ...rest }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  if (radius) style.borderRadius = radius;
  return (
    <span className={`${styles.skeleton} ${className ?? ''}`.trim()} style={style} aria-hidden={rest['aria-label'] ? undefined : true} {...rest} />
  );
}
