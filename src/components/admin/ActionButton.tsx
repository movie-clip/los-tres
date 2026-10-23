import styles from './ActionButton.module.css';

export type ActionButtonProps = {
  label: string;
  /** An accessible name that begins with `label` and adds what it acts on. */
  ariaLabel?: string;
  onClick: () => void;
  testId?: string;
};

/**
 * An outlined button that does not submit a form: it opens or closes something
 * on the page. It looks exactly like the outlined PendingButton (the styles are
 * composed from it) but reads no form status.
 */
export function ActionButton({ label, ariaLabel, onClick, testId }: ActionButtonProps) {
  return (
    <button type="button" className={styles.button} aria-label={ariaLabel} onClick={onClick} data-testid={testId}>
      {label}
    </button>
  );
}
