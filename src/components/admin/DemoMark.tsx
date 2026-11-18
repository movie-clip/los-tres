import styles from './DemoMark.module.css';

/**
 * The one marker of a demonstration shop, feed or network: filled grey with no
 * border, so it is never mistaken for a status tag. Not focusable.
 */
export function DemoMark({ label }: { label: string }) {
  return (
    <span className={styles.mark} data-testid="demo-mark">
      {label}
    </span>
  );
}
