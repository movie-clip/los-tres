'use client';

import { useId } from 'react';

import { ActionButton } from './ActionButton';
import { PendingButton } from './PendingButton';
import styles from './ConfirmPanel.module.css';

export type ConfirmPanelProps = {
  /** "¿Desactivar el feed 3 de Tienda?", already translated. */
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  /** Shown on the confirm button while the surrounding form is submitting. */
  confirmPendingLabel: string;
  /** Called by "Cancelar" and by Escape. */
  onCancel: () => void;
  testId?: string;
};

/**
 * An inline confirmation, in the admin notice look. Rendered inside the form
 * that carries the action, so the confirm button submits it. Cancel first, then
 * confirm. Never a browser dialog and never a modal.
 */
export function ConfirmPanel({
  title,
  body,
  cancelLabel,
  confirmLabel,
  confirmPendingLabel,
  onCancel,
  testId,
}: ConfirmPanelProps) {
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={styles.panel}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <span id={titleId} className={styles.title}>
        {title}
      </span>
      <span className={styles.body}>{body}</span>
      <div className={styles.buttons}>
        <ActionButton label={cancelLabel} onClick={onCancel} testId="source-cancel" />
        <PendingButton variant="filled" label={confirmLabel} pendingLabel={confirmPendingLabel} testId="source-confirm-yes" />
      </div>
    </div>
  );
}
