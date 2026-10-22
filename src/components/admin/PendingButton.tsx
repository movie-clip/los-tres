'use client';

import { useFormStatus } from 'react-dom';

import styles from './PendingButton.module.css';

export type PendingButtonProps = {
  variant: 'filled' | 'outlined';
  label: string;
  /** Shown while the surrounding form is submitting. Ends with the ellipsis character. */
  pendingLabel: string;
  /** The filled sign-in button spans its form column. */
  fullWidth?: boolean;
  testId?: string;
};

/**
 * A submit button that reads the pending state of the form around it. While
 * pending it swaps the label, greys out and ignores a second press; it is
 * aria-disabled and not disabled, so it stays in the focus order.
 */
export function PendingButton({ variant, label, pendingLabel, fullWidth, testId }: PendingButtonProps) {
  const { pending } = useFormStatus();
  const className = [
    styles.button,
    variant === 'filled' ? styles.filled : styles.outlined,
    fullWidth ? styles.full : '',
    pending ? styles.pending : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="submit"
      className={className}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      data-testid={testId}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
