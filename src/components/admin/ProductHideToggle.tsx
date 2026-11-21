'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import type { HideActionState } from '@/app/admin/(shell)/productos/actions';

import { ErrorBlock } from './ErrorBlock';
import { PendingButton } from './PendingButton';
import { ProductState } from './ProductState';
import styles from './ProductHideToggle.module.css';

/** Every string one toggle shows, already translated by the page, for both of its states. */
export type ProductHideLabels = {
  tagHidden: string;
  tagNotHidden: string;
  publicLabel: string;
  publicYes: string;
  publicNo: string;
  hide: string;
  /** An accessible name that begins with `hide` and adds what it acts on; null for the product's own button. */
  hideName: string | null;
  unhide: string;
  unhideName: string | null;
  saving: string;
  doneHidden: string;
  doneUnhidden: string;
  errorTitle: string;
  errorBody: string;
  goneBody: string;
};

export type ProductHideToggleProps = {
  kind: 'product' | 'offer';
  id: number;
  /** The stored flag and the public-now fact, as last rendered by the server. */
  hidden: boolean;
  publicNow: boolean;
  labels: ProductHideLabels;
  /** The server action for this kind, passed down by the page. */
  action: (previous: HideActionState, form: FormData) => Promise<HideActionState>;
  /** Product only: the identifier lines, drawn between the two facts and the button. */
  children?: React.ReactNode;
};

const IDLE: HideActionState = { status: 'idle' };

/** Next throws a redirect as an error carrying a NEXT_REDIRECT digest; it is navigation, not a failure. */
function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/**
 * The state of one product or one offer and the one control that changes it:
 * a form that names the state it wants ("hide" or "unhide", never a flip) and
 * never navigates, so the list state in the address survives. What it shows
 * after a press is what the server stored, never what the request asked for:
 * the action's answer until the page's own read changes, and the page's read
 * after that (an offer press can change the product's "en el sitio ahora").
 * Nothing asks for confirmation (D-9).
 */
export function ProductHideToggle({ kind, id, hidden, publicNow, labels, action, children }: ProductHideToggleProps) {
  // A transport failure (a 500, a dropped connection) rejects the action's promise, which would
  // reach the error boundary and replace the page. It becomes a failed result for this row instead.
  // Next's own redirect (a session that has ended) is rethrown so it still navigates to sign-in.
  const guardedAction = async (previous: HideActionState, form: FormData): Promise<HideActionState> => {
    try {
      const result = await action(previous, form);
      return result && typeof result === 'object' ? result : previous;
    } catch (error) {
      if (isNextRedirect(error)) throw error;
      return { status: 'failed', kind, id };
    }
  };
  const [state, formAction, pending] = useActionState(guardedAction, IDLE);

  // The answer holds only while the page's read is the one it arrived with: a refreshed read
  // (the page is revalidated after a press) is newer than the answer and takes over.
  const readKey = `${hidden}|${publicNow}`;
  const [arrived, setArrived] = useState({ state, readKey });
  if (arrived.state !== state) setArrived({ state, readKey });
  const stored = state.status === 'done' && state.kind === kind && state.id === id && arrived.readKey === readKey ? state : null;
  const shownHidden = stored ? stored.hidden : hidden;
  const shownPublicNow = stored ? stored.publicNow : publicNow;

  // Focus stays on the row's button after any result: its label has changed, the button has not.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status !== 'idle') formRef.current?.querySelector('button')?.focus();
  }, [state]);

  const result = pending ? null : state;
  return (
    <div className={`${styles.root} ${kind === 'offer' ? styles.offer : styles.product}`} data-testid={`${kind}-toggle`}>
      <div className={styles.state}>
        <ProductState
          hidden={shownHidden}
          tagHidden={labels.tagHidden}
          tagNotHidden={labels.tagNotHidden}
          publicNow={shownPublicNow}
          publicLabel={labels.publicLabel}
          publicYes={labels.publicYes}
          publicNo={labels.publicNo}
          testIdPrefix={kind}
        />
      </div>
      {children ? <div className={styles.extra}>{children}</div> : null}
      <form action={formAction} ref={formRef} className={styles.form}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="target" value={shownHidden ? 'unhide' : 'hide'} />
        <PendingButton
          variant={kind === 'product' ? 'filled' : 'outlined'}
          label={shownHidden ? labels.unhide : labels.hide}
          pendingLabel={labels.saving}
          ariaLabel={(shownHidden ? labels.unhideName : labels.hideName) ?? undefined}
          keepNameWhilePending
          testId={`${kind}-toggle-button`}
        />
      </form>
      <div role="status" className={styles.feedback}>
        {result && result.status === 'done' ? (
          <span className={styles.done} data-testid={`${kind}-done`}>
            {result.hidden ? labels.doneHidden : labels.doneUnhidden}
          </span>
        ) : null}
      </div>
      {result && (result.status === 'failed' || result.status === 'gone') ? (
        <div className={styles.error}>
          <ErrorBlock title={labels.errorTitle} message={result.status === 'gone' ? labels.goneBody : labels.errorBody} />
        </div>
      ) : null}
    </div>
  );
}
