import styles from './LinkButton.module.css';

export type LinkButtonProps = {
  href: string;
  label: string;
  /** An accessible name that begins with `label` and adds what the link acts on. */
  ariaLabel?: string;
  testId?: string;
};

/** An anchor in the outlined button look, for going to a form or back. A plain anchor, never a prefetch. */
export function LinkButton({ href, label, ariaLabel, testId }: LinkButtonProps) {
  return (
    <a href={href} className={styles.link} aria-label={ariaLabel} data-testid={testId}>
      {label}
    </a>
  );
}
