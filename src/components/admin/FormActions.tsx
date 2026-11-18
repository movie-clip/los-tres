import { LinkButton } from './LinkButton';
import { PendingButton } from './PendingButton';
import styles from './FormActions.module.css';

export type FormActionsProps = {
  cancel: { href: string; label: string };
  submit: { label: string; pendingLabel: string };
};

/** "Cancelar" as a link button, then the filled submit, as the confirm panel orders its pair. Inside the form. */
export function FormActions({ cancel, submit }: FormActionsProps) {
  return (
    <div className={styles.actions}>
      <LinkButton href={cancel.href} label={cancel.label} testId="form-cancel" />
      <PendingButton variant="filled" label={submit.label} pendingLabel={submit.pendingLabel} testId="form-submit" />
    </div>
  );
}
