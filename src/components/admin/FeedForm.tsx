'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { SourceFormState } from '@/app/admin/(shell)/tiendas/actions';

import { ConfirmPanel } from './ConfirmPanel';
import { ErrorBlock } from './ErrorBlock';
import { FieldHint } from './FieldHint';
import { FormActions } from './FormActions';
import { InfoBlock } from './InfoBlock';
import { LinkButton } from './LinkButton';
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
  /** The source choice on a create form, and the fixed "Origen:" line on an edit (S3.7). */
  source: {
    label: string;
    optionNetwork: string;
    optionFile: string;
    hintNetwork: string;
    hintFile: string;
    fixedLabel: string;
    fixedNetwork: string;
    fixedFile: string;
  };
  /** The catalogue-file name field, its warning and its confirmation (S3.7). */
  file: {
    label: string;
    /** The format hint on a create, "Déjalo como está…" on an edit. */
    hint: string;
    /** Replaces the hint after a refusal or a failure, because the field is empty or back at the stored name. */
    refill: string;
    /** Under the field when the stored name cannot be shown. */
    storedUnavailable: string;
    warningTitle: string;
    warningBody: string;
    confirmTitle: string;
  };
  /** The inline block that stands in for Red and URL when no network exists and the https source is chosen. */
  missingNetworkTitle: string;
  missingNetworkBody: string;
  cancel: string;
  /** "Crear feed" or "Guardar cambios". */
  submit: string;
  submitting: string;
  failedTitle: string;
  failedBody: string;
  errors: Pick<SourceErrorLabels, 'shop' | 'network' | 'url' | 'source' | 'fileName'>;
};

type Source = 'affiliate_network' | 'catalogue_file';

type Common = {
  action: SourceFormAction;
  labels: FeedFormLabels;
  cancelHref: string;
};

export type FeedFormProps =
  | (Common & {
      mode: 'create';
      shops: SelectOption[];
      networks: SelectOption[];
      /** The shop from `?tienda=` when it exists, else ''. */
      defaultShopId: string;
      /** The way to the create-network form, shown when the https source is chosen and no network exists. */
      addNetwork: { href: string; label: string };
    })
  | (Common & {
      mode: 'edit';
      source: 'affiliate_network';
      id: number;
      /** The shop's name, shown as text: a feed's shop is not a control (AC 18). */
      shopName: string;
      networks: SelectOption[];
      /** The stored network's id as a string. */
      defaultNetworkId: string;
      approved: boolean;
      demo: boolean;
      /** The host or the no-host phrase, already translated. */
      domain: string;
    })
  | (Common & {
      mode: 'edit';
      source: 'catalogue_file';
      id: number;
      shopName: string;
      approved: boolean;
      demo: boolean;
      /** The stored name when it is a valid bare name, else null (the stored value is never a fallback). */
      fileName: string | null;
    });

/** The field that carries the feed address. The form reads it once, at submit, to decide whether to ask. */
const ADDRESS_FIELD = 'url';
/** The field that carries a catalogue file name. */
const FILE_FIELD = 'fileName';
const WARNING_ID = 'feed-warning';

/**
 * The feed form (S4, S3.7). A create form chooses the source first, an affiliate network or a catalogue
 * file, and shows only the fields of that source: the other block is not rendered, so it submits nothing.
 * On an edit the source is fixed text. The address input is uncontrolled and has no default value, on a
 * create form, on an edit form and after every refusal: a stored address never reaches this component, only
 * its host (D-T10). The file name input starts empty on a create and holds the stored name on an edit (a bare
 * file name may be shown, AC 13); after a refusal it returns to that, never to what was typed. On an approved
 * feed a typed address, or a file name that differs from the stored one, opens the confirm panel before the
 * save; the static warning above the field is what holds without script.
 */
export function FeedForm(props: FeedFormProps) {
  const { action, labels, cancelHref } = props;
  const { state, formAction, pending, formRef, errors, values } = useSourceForm(action);
  const editing = props.mode === 'edit';
  const fileEdit = props.mode === 'edit' && props.source === 'catalogue_file';
  const networks = 'networks' in props ? props.networks : [];
  const storedFileName = props.mode === 'edit' && props.source === 'catalogue_file' ? props.fileName : null;
  const asks = props.mode === 'edit' && props.approved && (props.source === 'catalogue_file' || !props.demo);

  // The source is the admin's choice on a create form (the https source is the default, the file source when
  // no network exists) and the stored one on an edit. The server echoes neither the source nor, when the file
  // source is chosen, the network, so both choices live here and survive a refused result.
  const [source, setSource] = useState<Source>(
    props.mode === 'create' ? (networks.length === 0 ? 'catalogue_file' : 'affiliate_network') : props.source,
  );
  const [networkChoice, setNetworkChoice] = useState(props.mode === 'edit' && props.source === 'affiliate_network' ? props.defaultNetworkId : '');

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
    const form = new FormData(event.currentTarget);
    if (fileEdit) {
      // The same rule as the server's: the trimmed name against the stored one, exactly (no case folding).
      const typed = form.get(FILE_FIELD);
      if (typeof typed === 'string' && typed.trim() !== '' && typed.trim() !== storedFileName) {
        event.preventDefault();
        setOpenedFor(state);
      }
      return;
    }
    const typed = form.get(ADDRESS_FIELD);
    if (typeof typed === 'string' && typed.trim() !== '') {
      event.preventDefault();
      setOpenedFor(state);
    }
  }

  const shopError = fieldMessage(errors, labels.errors, 'shop');
  const sourceError = fieldMessage(errors, labels.errors, 'source');
  const networkError = fieldMessage(errors, labels.errors, 'network');
  const addressError = fieldMessage(errors, labels.errors, 'url');
  const fileError = fieldMessage(errors, labels.errors, 'fileName');
  const refilled = state.status === 'refused' || state.status === 'failed';
  const shopChoice = state.status === 'idle' ? (props.mode === 'create' ? props.defaultShopId : '') : (values.shopId ?? '');

  // React does not move a select's default when defaultValue changes, so the form reset after an action
  // puts back the first one. After each result the choices are set again to what the admin had picked.
  useEffect(() => {
    if (state.status === 'idle') return;
    const form = formRef.current;
    if (!form) return;
    for (const [name, choice] of [['shopId', shopChoice], ['source', source], ['networkId', networkChoice]] as const) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLSelectElement) field.value = choice;
    }
    // Only a new result moves the selects; a later render must not undo the admin's own change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const confirmTitle = fileEdit ? labels.file.confirmTitle : labels.confirmTitle;
  const noNetwork = props.mode === 'create' && source === 'affiliate_network' && networks.length === 0;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={onSubmit}
      // Changing a field closes an open confirmation, so it never describes a form that has moved on.
      onChange={(event) => {
        setOpenedFor(null);
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (target.name === 'source') setSource(target.value === 'catalogue_file' ? 'catalogue_file' : 'affiliate_network');
        if (target.name === 'networkId') setNetworkChoice(target.value);
      }}
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
      {props.mode === 'create' ? (
        <SelectField
          id="source-origin"
          name="source"
          label={labels.source.label}
          options={[
            { value: 'affiliate_network', label: labels.source.optionNetwork },
            { value: 'catalogue_file', label: labels.source.optionFile },
          ]}
          defaultValue={source}
          readOnly={pending}
          error={sourceError}
          hint={source === 'catalogue_file' ? labels.source.hintFile : labels.source.hintNetwork}
        />
      ) : (
        <ValueLine
          label={labels.source.fixedLabel}
          value={fileEdit ? labels.source.fixedFile : labels.source.fixedNetwork}
          testId="source-origin-fixed"
        />
      )}
      {source === 'affiliate_network' && !noNetwork ? (
        <SelectField
          id="source-network"
          name="networkId"
          label={labels.network}
          prompt={editing ? undefined : labels.networkPrompt}
          options={networks}
          defaultValue={networkChoice}
          readOnly={pending}
          error={networkError}
        />
      ) : null}
      {props.mode === 'edit' && props.source === 'affiliate_network' ? (
        <ValueLine label={labels.domainLabel} value={props.domain} testId="source-domain" />
      ) : null}
      {asks ? (
        <InfoBlock
          id={WARNING_ID}
          title={fileEdit ? labels.file.warningTitle : labels.warningTitle}
          body={fileEdit ? labels.file.warningBody : labels.warningBody}
          testId="feed-warning"
        />
      ) : null}
      {noNetwork ? (
        <InfoBlock title={labels.missingNetworkTitle} body={labels.missingNetworkBody} testId="missing-network">
          {props.mode === 'create' ? <LinkButton href={props.addNetwork.href} label={props.addNetwork.label} /> : null}
        </InfoBlock>
      ) : source === 'catalogue_file' ? (
        <TextField
          id="source-file"
          name={FILE_FIELD}
          label={labels.file.label}
          type="text"
          autoComplete="off"
          defaultValue={storedFileName ?? undefined}
          readOnly={pending}
          error={fileError}
          // After any refusal or failure the field is empty (create) or back at the stored name (edit), so
          // the hint says so, even beside a message of its own (02-ux § 6).
          hint={
            refilled
              ? labels.file.refill
              : fileEdit && storedFileName === null
                ? labels.file.storedUnavailable
                : labels.file.hint
          }
          describedBy={asks ? WARNING_ID : undefined}
        />
      ) : props.mode === 'create' || !props.demo ? (
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
            title={confirmTitle}
            body={labels.confirmBody}
            cancelLabel={labels.cancel}
            confirmLabel={labels.confirmYes}
            confirmPendingLabel={labels.confirmYesPending}
            onCancel={cancelConfirm}
            testId="feed-confirm"
          />
        ) : noNetwork ? (
          <div>
            <LinkButton href={cancelHref} label={labels.cancel} testId="form-cancel" />
          </div>
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
