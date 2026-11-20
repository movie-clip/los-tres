'use client';

import { useFormStatus } from 'react-dom';

import styles from './CategoryButton.module.css';

export type CategoryIntent = 'assign' | 'outside' | 'remove';

export type CategoryButtonProps = {
  variant: 'filled' | 'outlined';
  /** Which action this button asks for; the feed's one action dispatches on it. */
  intent: CategoryIntent;
  label: string;
  /** Shown on this button while its row saves. Ends with the ellipsis character. */
  pendingLabel: string;
  /** An accessible name that begins with `label` and adds the category. Not used while pending. */
  ariaLabel: string;
  testId?: string;
};

/**
 * A submit button for a row with several of them. It looks like the Pending
 * button, but only the button that was pressed reads "Guardando…": the form's
 * pending data carries the `intent` of the submitter. While the row saves every
 * button of it ignores a press and stays in the focus order.
 */
export function CategoryButton({ variant, intent, label, pendingLabel, ariaLabel, testId }: CategoryButtonProps) {
  const { pending, data } = useFormStatus();
  const pressed = pending && data?.get('intent') === intent;
  const className = [styles.button, variant === 'filled' ? styles.filled : styles.outlined, pressed ? styles.pending : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      className={className}
      aria-label={pressed ? undefined : ariaLabel}
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      data-testid={testId}
    >
      {pressed ? pendingLabel : label}
    </button>
  );
}
