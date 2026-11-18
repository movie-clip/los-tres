import { useActionState, useEffect, useRef, type RefObject } from 'react';

import type { SourceFormState, SourceFormValues } from '@/app/admin/(shell)/tiendas/actions';
import type { SourceFieldErrors } from '@/server/admin/sources';

// The shared behaviour of the three source forms (S3.1): the action state, the
// transport-failure guard and the focus after a result. Imported by client
// components only. It never reads the feed address field of a form: the values
// it echoes are the four the action itself echoes.

/** A create or edit server action, passed down by the page. */
export type SourceFormAction = (previous: SourceFormState, form: FormData) => Promise<SourceFormState>;

/** The message for each refusal code of each field, already translated and with its limit filled in. */
export type SourceErrorLabels = {
  [Field in keyof SourceFieldErrors]-?: Record<NonNullable<SourceFieldErrors[Field]>, string>;
};

const IDLE: SourceFormState = { status: 'idle' };
const ECHOED = ['name', 'slug', 'shopId', 'networkId'] as const;

/** Next throws a redirect as an error carrying a NEXT_REDIRECT digest; it is navigation, not a failure. */
function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/** What a form is shown again with after a transport failure: the same four fields the action echoes. */
function typedValues(form: FormData): SourceFormValues {
  const values: SourceFormValues = {};
  for (const field of ECHOED) {
    const raw = form.get(field);
    if (typeof raw === 'string') values[field] = raw;
  }
  return values;
}

export type SourceForm = {
  state: SourceFormState;
  formAction: (form: FormData) => void;
  pending: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  /** The refusal codes of the last result; empty otherwise. */
  errors: SourceFieldErrors;
  /** What the admin typed, from the last result; empty before the first. */
  values: SourceFormValues;
};

/**
 * Binds a source form to its server action. A transport failure (a 500, a
 * dropped connection) rejects the action's promise, which would reach the error
 * boundary and replace the page: it becomes a failed state instead, keeping
 * the typed values. Next's own redirect (a saved form, or a session that has
 * ended) is rethrown so it still navigates. After a refusal focus goes to the
 * first failing field, after a failure to the first field of the form; the
 * first load moves no focus.
 */
export function useSourceForm(action: SourceFormAction): SourceForm {
  const guarded = async (previous: SourceFormState, form: FormData): Promise<SourceFormState> => {
    try {
      const result = await action(previous, form);
      return result && typeof result === 'object' ? result : previous;
    } catch (error) {
      if (isNextRedirect(error)) throw error;
      return { status: 'failed', values: typedValues(form) };
    }
  };
  const [state, formAction, pending] = useActionState(guarded, IDLE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'idle') return;
    const form = formRef.current;
    if (!form) return;
    const invalid = state.status === 'refused' ? form.querySelector<HTMLElement>('[aria-invalid="true"]') : null;
    const first = form.querySelector<HTMLElement>('input:not([type="hidden"]), select');
    (invalid ?? first)?.focus();
  }, [state]);

  return {
    state,
    formAction,
    pending,
    formRef,
    errors: state.status === 'refused' ? state.errors : {},
    values: state.status === 'idle' ? {} : state.values,
  };
}

/**
 * The message for a field's refusal code, or undefined when the field passed.
 * One lookup for every field, so a form never names a field's code by hand.
 */
export function fieldMessage<Field extends keyof SourceErrorLabels>(
  errors: SourceFieldErrors,
  labels: Pick<SourceErrorLabels, Field>,
  field: Field,
): string | undefined {
  const code = errors[field];
  if (code === undefined) return undefined;
  const byCode: Record<string, string> = labels[field];
  return byCode[code];
}
