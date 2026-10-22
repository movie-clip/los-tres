'use client';

import { useActionState, useEffect, useRef } from 'react';

import { AdminNotice } from '@/components/admin/AdminNotice';
import { ErrorBlock } from '@/components/admin/ErrorBlock';
import { PendingButton } from '@/components/admin/PendingButton';
import { TextField } from '@/components/admin/TextField';
import { signInAction, type SignInState } from '@/server/auth/actions';

import styles from './page.module.css';

/** Every string the form shows, already translated by the page. */
export type SignInLabels = {
  emailLabel: string;
  passwordLabel: string;
  submit: string;
  submitting: string;
  emailRequired: string;
  emailInvalid: string;
  passwordRequired: string;
  errorTitle: string;
  invalidCredentials: string;
  unavailable: string;
};

const IDLE: SignInState = { status: 'idle' };

/**
 * The sign-in form. It posts to signInAction through useActionState, so it
 * also works without JavaScript. At most one message block shows above the
 * fields: an error replaces the arrival notice; field messages need no block.
 */
export function SignInForm({ labels, notice }: { labels: SignInLabels; notice: string | null }) {
  const [state, formAction, pending] = useActionState(signInAction, IDLE);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Focus follows a result, never the first load: the first invalid field, or
  // the password after a refusal (the email if it is somehow empty).
  useEffect(() => {
    if (state.status === 'idle') return;
    if (state.status === 'invalid') {
      (state.fieldErrors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    (state.email ? passwordRef : emailRef).current?.focus();
  }, [state]);

  const email = state.status === 'idle' ? '' : state.email;
  const fieldErrors = state.status === 'invalid' ? state.fieldErrors : {};
  const emailError =
    fieldErrors.email === 'required'
      ? labels.emailRequired
      : fieldErrors.email === 'invalid'
        ? labels.emailInvalid
        : undefined;
  const passwordError = fieldErrors.password ? labels.passwordRequired : undefined;

  return (
    <form action={formAction} noValidate className={styles.form} data-testid="sign-in-form">
      {state.status === 'rejected' ? (
        <ErrorBlock title={labels.errorTitle} message={labels.invalidCredentials} />
      ) : state.status === 'unavailable' ? (
        <ErrorBlock title={labels.errorTitle} message={labels.unavailable} />
      ) : state.status === 'idle' && notice ? (
        <AdminNotice text={notice} />
      ) : null}
      <TextField
        id="admin-email"
        name="email"
        label={labels.emailLabel}
        type="email"
        inputMode="email"
        autoComplete="username"
        defaultValue={email}
        readOnly={pending}
        error={emailError}
        inputRef={emailRef}
      />
      <TextField
        id="admin-password"
        name="password"
        label={labels.passwordLabel}
        type="password"
        autoComplete="current-password"
        readOnly={pending}
        error={passwordError}
        inputRef={passwordRef}
      />
      <PendingButton
        variant="filled"
        label={labels.submit}
        pendingLabel={labels.submitting}
        fullWidth
        testId="sign-in-submit"
      />
    </form>
  );
}
