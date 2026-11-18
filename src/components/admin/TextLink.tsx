import styles from './TextLink.module.css';

export type TextLinkProps = {
  href: string;
  label: string;
  /** An accessible name that begins with `label` and adds what the link acts on. */
  ariaLabel?: string;
  testId?: string;
};

/** A plain anchor (a full navigation, never a prefetch) at least 44 px tall. */
export function TextLink({ href, label, ariaLabel, testId }: TextLinkProps) {
  return (
    <a href={href} className={styles.link} aria-label={ariaLabel} data-testid={testId}>
      {label}
    </a>
  );
}
