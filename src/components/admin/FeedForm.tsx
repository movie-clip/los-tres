'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { SourceFormState } from '@/app/admin/(shell)/tiendas/actions';

import { ConfirmPanel } from './ConfirmPanel';
import { ErrorBlock } from './ErrorBlock';
import { FieldHint } from './FieldHint';
import { FormActions } from './FormActions';
import { InfoBlock } from './InfoBlock';
import { SelectField, type SelectOption } from './SelectField';
import { TextField } from './TextField';
import { ValueLine } from './ValueLine';
import { fieldMessage, useSourceForm, type SourceErrorLabels, type SourceFormAction } from './useSourceForm';
import styles from './SourceForm.module.css';

/** Every string the feed form shows, already translated by the page. Strings of the other mode are left empty. */
export type FeedFormLabels = {
  shop: string;
  shopPrompt: string;
  /** "Tienda:", the edit form's Value line. */
  shopFixed: string;
  network: string;
  networkPrompt: string;
  /** "URL del feed" or "Nueva URL del feed". */
  address: string;
  /** Under the address field: the format hint, or "Déjala vacía…" on an edit. */
  addressHint: string;
  /** Replaces the hint after a refusal or a failure, because the field is empty again. */
  addressRefill: string;
  /** "Dominio actual:" or, for a demonstration feed, "Dominio:". */
  domainLabel: string;
  warningTitle: string;
  warningBody: string;
  /** Under a demonstration feed's domain line. */
  demoHint: string;
  confirmTitle: string;
  confirmBody: string;
  confirmYes: string;
  confirmYesPending: string;
  cancel: string;
  /** "Crear feed" or "Guardar cambios". */
  submit: string;
  submitting: string;
  failedTitle: string;
  failedBody: string;
  errors: Pick<SourceErrorLabels, 'shop' | 'network' | 'url'>;
};

type Common = {
  action: SourceFormAction;
  labels: FeedFormLabels;
  cancelHref: string;
  networks: SelectOption[];
};

export type FeedFormProps =
  | (Common & {
      mode: 'create';
      shops: SelectOption[];
      /** The shop from `?tienda=` when it exists, else ''. */
      defaultShopId: string;
    })
  | (Common & {
      mode: 'edit';
      id: number;
      /** The shop's name, shown as text: a feed's shop is not a control (AC 18). */
      shopName: string;
      /** The stored network's id as a string. */
      defaultNetworkId: string;
      approved: boolean;
      demo: boolean;
      /** The host or the no-host phrase, already translated. */
      domain: string;
    });

/** The field that carries the feed address. The form reads it once, at submit, to decide whether to ask. */
const ADDRESS_FIELD = 'url';
const WARNING_ID = 'feed-warning';

/**
 * The feed form (S4). The address input is uncontrolled and has no default
 * value, on a create form, on an edit form and after every refusal: a stored
 * address never reaches this component, only its host (D-T10). On an approved,
 * non-demo feed a typed address opens the confirm panel before the save; the
 * static warning above the field is what holds without script.
 */
export function FeedForm(props: FeedFormProps) {
  const { action, labels, cancelHref, networks } = props;
  const { state, formAction, pending, formRef, errors, values } = useSourceForm(action);
  const editing = props.mode === 'edit';
  const asks = props.mode === 'edit' && props.approved && !props.demo;
  const showsAddress = props.mode === 'create' || !props.demo;

  // The panel is open only for the state it was opened in: any new result closes it.
  const [openedFor, setOpenedFor] = useState<SourceFormState | null>(null);
  const confirming = openedFor === state;
  const slotRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  const returnFocus = useRef(false);

  // Focus is never lost: into the panel on "Cancelar" when it opens, and back to
  // "Guardar cambios" when the admin cancels it. The first load moves no focus.
  useEffect(() => {
    if (confirming) slotRef.current?.querySelector('button')?.focus();
    else if (wasConfirming.current && returnFocus.current) slotRef.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    wasConfirming.current = confirming;
    returnFocus.current = false;
  }, [confirming]);

  const cancelConfirm = () => {
    returnFocus.current = true;
    setOpenedFor(null);
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!asks || confirming) return;
    const typed = new FormData(event.currentTarget).get(ADDRESS_FIELD);
    if (typeof typed === 'string' && typed.trim() !== '') {
      event.preventDefault();
      setOpenedFor(state);
    }
  }

  const shopError = fieldMessage(errors, labels.errors, 'shop');
  const networkError = fieldMessage(errors, labels.errors, 'network');
  const addressError = fieldMessage(errors, labels.errors, 'url');
  const refilled = state.status === 'refused' || state.status === 'failed';
  const defaultNetwork = values.networkId ?? (props.mode === 'edit' ? props.defaultNetworkId : '');
  const shopChoice = state.status === 'idle' ? (props.mode === 'create' ? props.defaultShopId : '') : (values.shopId ?? '');

  // React does not move a select's default when defaultValue changes, so the form reset after an action
  // puts back the first one. After each result the two choices are set again to what the server echoed.
  useEffect(() => {
    if (state.status === 'idle') return;
    const form = formRef.current;
    if (!form) return;
    for (const [name, choice] of [['shopId', shopChoice], ['networkId', defaultNetwork]] as const) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLSelectElement) field.value = choice;
    }
    // Only a new result moves the selects; a later render must not undo the admin's own change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      // Changing a field closes an open confirmation, so it never describes a form that has moved on.
      onChange={() => setOpenedFor(null)}
      noValidate
      className={styles.form}
      data-testid="source-form"
    >
      {state.status === 'failed' ? <ErrorBlock title={labels.failedTitle} message={labels.failedBody} /> : null}
      {props.mode === 'edit' ? <input type="hidden" name="id" value={props.id} /> : null}
      {props.mode === 'create' ? (
        <SelectField
          id="source-shop"
          name="shopId"
          label={labels.shop}
          prompt={labels.shopPrompt}
          options={props.shops}
          defaultValue={values.shopId ?? props.defaultShopId}
          readOnly={pending}
          error={shopError}
        />
      ) : (
        <ValueLine label={labels.shopFixed} value={props.shopName} testId="source-shop-fixed" />
      )}
      <SelectField
        id="source-network"
        name="networkId"
        label={labels.network}
        prompt={editing ? undefined : labels.networkPrompt}
        options={networks}
        defaultValue={defaultNetwork}
        readOnly={pending}
        error={networkError}
      />
      {props.mode === 'edit' ? (
        <ValueLine label={labels.domainLabel} value={props.domain} testId="source-domain" />
      ) : null}
      {asks ? (
        <InfoBlock id={WARNING_ID} title={labels.warningTitle} body={labels.warningBody} testId="feed-warning" />
      ) : null}
      {showsAddress ? (
        <TextField
          id="source-address"
          name={ADDRESS_FIELD}
          label={labels.address}
          type="url"
          autoComplete="off"
          readOnly={pending}
          error={addressError}
          hint={refilled && !addressError ? labels.addressRefill : labels.addressHint}
          describedBy={asks ? WARNING_ID : undefined}
        />
      ) : (
        <FieldHint text={labels.demoHint} testId="feed-demo-hint" />
      )}
      <div ref={slotRef}>
        {confirming ? (
          <ConfirmPanel
            title={labels.confirmTitle}
            body={labels.confirmBody}
            cancelLabel={labels.cancel}
            confirmLabel={labels.confirmYes}
            confirmPendingLabel={labels.confirmYesPending}
            onCancel={cancelConfirm}
            testId="feed-confirm"
          />
        ) : (
          <FormActions
            cancel={{ href: cancelHref, label: labels.cancel }}
            submit={{ label: labels.submit, pendingLabel: labels.submitting }}
          />
        )}
      </div>
    </form>
  );
}
