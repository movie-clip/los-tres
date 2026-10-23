import styles from './StatusTag.module.css';

export type StatusTagProps = {
  /** Approved is filled, not approved is outlined, paused (a feed approved under an unapproved shop) is dashed. */
  variant: 'approved' | 'notApproved' | 'paused';
  /** The words carry the meaning; shape and fill only back them up. */
  label: string;
  testId?: string;
};

/** A text tag for an approval state. Not interactive and not focusable. */
export function StatusTag({ variant, label, testId }: StatusTagProps) {
  const variantClass =
    variant === 'approved' ? styles.approved : variant === 'paused' ? styles.paused : styles.notApproved;
  return (
    <span className={`${styles.tag} ${variantClass}`} data-testid={testId}>
      {label}
    </span>
  );
}
