'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import type { SourceActionState } from '@/app/admin/(shell)/tiendas/actions';

import { ActionButton } from './ActionButton';
import { ConfirmPanel } from './ConfirmPanel';
import { ErrorBlock } from './ErrorBlock';
import { PendingButton } from './PendingButton';
import { StatusTag } from './StatusTag';
import styles from './SourceRow.module.css';

/** Every string one row shows, already translated by the page, for both of its states. */
export type SourceRowLabels = {
  tagApproved: string;
  tagNotApproved: string;
  /** Feed only: approved while its shop is not. */
  tagPaused: string | null;
  approve: string;
  approving: string;
  approveName: string;
  disable: string;
  disableName: string;
  confirmTitle: string;
  confirmBody: string;
  confirmYes: string;
  confirmYesPending: string;
  cancel: string;
  doneApproved: string;
  doneDisabled: string;
  /** Feed only: the result line when the feed was approved but its shop is not. */
  doneApprovedPaused: string | null;
  errorTitle: string;
  errorBody: string;
};

export type SourceRowProps = {
  kind: 'shop' | 'feed';
  id: number;
  /** "Tienda Demo" or "Feed 3". */
  title: string;
  /** The meta line, already joined. */
  meta: string;
  /** A group note or the paused line; at most one. */
  note: string | null;
  /** The stored flag, as last rendered by the server. */
  approved: boolean;
  /** Feed only: approved while its shop is not. */
  paused: boolean;
  labels: SourceRowLabels;
  /** The server action for this kind, passed down by the page. */
  action: (previous: SourceActionState, form: FormData) => Promise<SourceActionState>;
};

const IDLE: SourceActionState = { status: 'idle' };

/** Next throws a redirect as an error carrying a NEXT_REDIRECT digest; it is navigation, not a failure. */
function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/** The result line for a stored result, chosen from what the server stored and never from the request. */
function doneLine(state: Extract<SourceActionState, { status: 'done' }>, labels: SourceRowLabels): string {
  if (!state.approved) return labels.doneDisabled;
  if (state.kind === 'feed' && !state.shopApproved && labels.doneApprovedPaused) return labels.doneApprovedPaused;
  return labels.doneApproved;
}

/**
 * One shop or feed: its name, meta line, optional note, a state tag and one
 * action. Approving acts at once; disabling opens an inline confirmation first.
 * The tag and button always follow the stored flag the server last rendered, so
 * the row never claims a state the server has not stored.
 */
export function SourceRow({ kind, id, title, meta, note, approved, paused, labels, action }: SourceRowProps) {
  // A transport failure (a 500, a dropped connection) rejects the action's promise,
  // which would reach the error boundary and replace the page. It becomes a failed
  // result for this row instead. Next's own redirect (a session that has ended) is
  // rethrown so it still navigates to sign-in.
  const guardedAction = async (previous: SourceActionState, form: FormData): Promise<SourceActionState> => {
    try {
      const result = await action(previous, form);
      return result && typeof result === 'object' ? result : previous;
    } catch (error) {
      if (isNextRedirect(error)) throw error;
      return { status: 'failed', kind, id };
    }
  };
  const [state, formAction, pending] = useActionState(guardedAction, IDLE);
  // The panel is open only for the state it was opened in: any new result closes it.
  const [openedFor, setOpenedFor] = useState<SourceActionState | null>(null);
  const confirming = openedFor === state;
  const slotRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  // Focus is never lost: into the panel on "Cancelar" when it opens, and back to
  // the row's button when it closes. The first button of the slot is the one.
  useEffect(() => {
    // Not on the first render: a page load moves no focus.
    if (confirming || wasConfirming.current) slotRef.current?.querySelector('button')?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  // After a result the button that was pressed may be gone (approve swaps to
  // disable), so focus goes to the row's current button.
  useEffect(() => {
    if (state.status !== 'idle') slotRef.current?.querySelector('button')?.focus();
  }, [state]);

  const Heading = kind === 'shop' ? 'h2' : 'h3';
  const tagLabel = approved ? (paused && labels.tagPaused ? labels.tagPaused : labels.tagApproved) : labels.tagNotApproved;
  const tagVariant = approved ? (paused ? 'paused' : 'approved') : 'notApproved';
  const close = () => setOpenedFor(null);

  return (
    <div data-testid={`source-${kind}-${id}`}>
      <div className={styles.grid}>
        <div className={styles.info}>
          <Heading className={kind === 'shop' ? styles.shopTitle : styles.feedTitle}>{title}</Heading>
          <span className={styles.meta}>{meta}</span>
          {note ? (
            <span className={styles.note} data-testid="source-note">
              {note}
            </span>
          ) : null}
        </div>
        {confirming ? (
          <div className={styles.panel} ref={slotRef}>
            <form action={formAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="target" value="disable" />
              <ConfirmPanel
                title={labels.confirmTitle}
                body={labels.confirmBody}
                cancelLabel={labels.cancel}
                confirmLabel={labels.confirmYes}
                confirmPendingLabel={labels.confirmYesPending}
                onCancel={close}
                testId="source-confirm"
              />
            </form>
          </div>
        ) : (
          <div className={styles.controls} ref={slotRef}>
            <StatusTag variant={tagVariant} label={tagLabel} testId="source-tag" />
            {approved ? (
              <ActionButton
                label={labels.disable}
                ariaLabel={labels.disableName}
                onClick={() => setOpenedFor(state)}
                testId="source-disable"
              />
            ) : (
              <form action={formAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="target" value="approve" />
                <PendingButton
                  variant="filled"
                  label={labels.approve}
                  pendingLabel={labels.approving}
                  ariaLabel={labels.approveName}
                  testId="source-approve"
                />
              </form>
            )}
          </div>
        )}
      </div>
      <div role="status" className={styles.feedback}>
        {!pending && state.status === 'done' ? (
          <span className={styles.done} data-testid="source-done">
            {doneLine(state, labels)}
          </span>
        ) : null}
      </div>
      {!pending && state.status === 'failed' ? (
        <div className={styles.error}>
          <ErrorBlock title={labels.errorTitle} message={labels.errorBody} />
        </div>
      ) : null}
    </div>
  );
}
