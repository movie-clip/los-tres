'use client';

import { ErrorBlock } from './ErrorBlock';
import { FieldHint } from './FieldHint';
import { FormActions } from './FormActions';
import { TextField } from './TextField';
import { ValueLine } from './ValueLine';
import { fieldMessage, useSourceForm, type SourceErrorLabels, type SourceFormAction } from './useSourceForm';
import styles from './SourceForm.module.css';

/** Every string the network and shop forms show, already translated by the page. */
export type NameSlugFormLabels = {
  name: string;
  slug: string;
  /** Under the slug field on a create form. */
  slugHint: string;
  /** The Value line label on an edit form, "Identificador:". */
  slugFixed: string;
  /** Under the Value line on an edit form. */
  slugFixedHint: string;
  cancel: string;
  submit: string;
  submitting: string;
  failedTitle: string;
  failedBody: string;
  errors: Pick<SourceErrorLabels, 'name' | 'slug'>;
};

export type NameSlugFormProps = {
  action: SourceFormAction;
  /** Present on an edit form only. */
  id?: number;
  /** The stored name and slug on an edit form; empty on a create form. */
  defaults: { name: string; slug: string };
  labels: NameSlugFormLabels;
  cancelHref: string;
};

/**
 * The network and shop form: a name and, on a create form, a slug. On an edit
 * form the slug is a Value line with no control (AC 9). It posts through
 * useActionState, so it also works without JavaScript. The typed name and slug
 * come back after a refusal; a form reset would otherwise empty them.
 */
export function NameSlugForm({ action, id, defaults, labels, cancelHref }: NameSlugFormProps) {
  const { state, formAction, pending, formRef, errors, values } = useSourceForm(action);
  const editing = id !== undefined;
  const nameError = fieldMessage(errors, labels.errors, 'name');
  const slugError = fieldMessage(errors, labels.errors, 'slug');

  return (
    <form ref={formRef} action={formAction} noValidate className={styles.form} data-testid="source-form">
      {state.status === 'failed' ? <ErrorBlock title={labels.failedTitle} message={labels.failedBody} /> : null}
      {editing ? <input type="hidden" name="id" value={id} /> : null}
      <TextField
        id="source-name"
        name="name"
        label={labels.name}
        type="text"
        autoComplete="off"
        defaultValue={values.name ?? defaults.name}
        readOnly={pending}
        error={nameError}
      />
      {editing ? (
        <div className={styles.fixed}>
          <ValueLine label={labels.slugFixed} value={defaults.slug} testId="source-slug-fixed" />
          <FieldHint text={labels.slugFixedHint} />
        </div>
      ) : (
        <TextField
          id="source-slug"
          name="slug"
          label={labels.slug}
          type="text"
          autoComplete="off"
          defaultValue={values.slug ?? ''}
          readOnly={pending}
          error={slugError}
          hint={labels.slugHint}
        />
      )}
      <FormActions
        cancel={{ href: cancelHref, label: labels.cancel }}
        submit={{ label: labels.submit, pendingLabel: labels.submitting }}
      />
    </form>
  );
}
