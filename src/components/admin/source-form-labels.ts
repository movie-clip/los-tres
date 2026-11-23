import type { getTranslations } from 'next-intl/server';

import { LOCALE } from '@/i18n/locale';

import type { FeedFormLabels } from './FeedForm';
import type { NameSlugFormLabels } from './NameSlugForm';
import type { SourceErrorLabels } from './useSourceForm';

// Finished strings for the three source forms, built from `Admin.Form` once for
// the six pages that draw them. Pure: a page passes its translator and the
// limits it read from the server's rules, and no component reads either.

/** The translator of the form strings, `getTranslations('Admin.Form')`. */
export type FormTranslate = Awaited<ReturnType<typeof getTranslations<'Admin.Form'>>>;

/**
 * The three length limits of the forms, as the server holds them (source-rules.ts). The page passes them in.
 * The feed form adds the file-name limit and the allowed endings (S3.7), already formatted by `fileKindsText`;
 * the network and shop forms pass neither, and their file-name messages stay empty because they never show one.
 */
export type FormLimits = { name: number; slug: number; address: number; fileName?: number; fileKinds?: string };

// CLDR drops the separator on four digits; the limit of an address reads 2.048.
const limitFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

// ".csv, .xml, .csv.gz o .xml.gz": the endings the file-name rule accepts, as the messages quote them.
const kindsFormat = new Intl.ListFormat(LOCALE, { style: 'long', type: 'disjunction' });

/** The accepted endings of a catalogue file name as one phrase, for the `{kinds}` value of the feed form copy. */
export function fileKindsText(kinds: readonly string[]): string {
  return kindsFormat.format(kinds);
}

/**
 * One string per refusal code of each field, beside the field at fault (05-ux
 * section 6). None repeats a typed value. The "taken" string names the kind the
 * form creates; a feed form never gets a slug refusal.
 */
export function sourceErrorLabels(t: FormTranslate, kind: 'network' | 'shop', limits: FormLimits): SourceErrorLabels {
  // Only the feed form gives the file-name limits; without them its messages are empty, never a made-up limit.
  const fileValues =
    limits.fileName !== undefined && limits.fileKinds !== undefined
      ? { max: limitFormat.format(limits.fileName), kinds: limits.fileKinds }
      : null;
  const file = (key: 'fileRequired' | 'fileTooLong' | 'fileNotAName' | 'fileUnusable' | 'fileWrongKind' | 'fileDuplicate') =>
    fileValues ? t(`Errors.${key}`, fileValues) : '';
  return {
    name: {
      required: t('Errors.nameRequired'),
      too_long: t('Errors.nameTooLong', { max: limitFormat.format(limits.name) }),
    },
    slug: {
      required: t('Errors.slugRequired'),
      invalid: t('Errors.slugInvalid'),
      too_long: t('Errors.slugTooLong', { max: limitFormat.format(limits.slug) }),
      reserved: t('Errors.slugReserved'),
      taken: kind === 'network' ? t('Errors.slugTakenNetwork') : t('Errors.slugTakenShop'),
    },
    shop: { required: t('Errors.shopRequired') },
    network: { required: t('Errors.networkRequired') },
    url: {
      required: t('Errors.urlRequired'),
      invalid: t('Errors.urlInvalid'),
      credentials: t('Errors.urlCredentials'),
      too_long: t('Errors.urlTooLong', { max: limitFormat.format(limits.address) }),
      duplicate: t('Errors.urlDuplicate'),
    },
    source: { invalid: t('Errors.sourceInvalid') },
    fileName: {
      required: file('fileRequired'),
      too_long: file('fileTooLong'),
      not_a_name: file('fileNotAName'),
      unusable: file('fileUnusable'),
      wrong_kind: file('fileWrongKind'),
      duplicate: file('fileDuplicate'),
    },
  };
}

/** The strings of the network and shop forms, in the create or the edit mode. */
export function nameSlugFormLabels(
  t: FormTranslate,
  kind: 'network' | 'shop',
  mode: 'create' | 'edit',
  limits: FormLimits,
): NameSlugFormLabels {
  const screen = kind === 'network' ? 'Network' : 'Shop';
  return {
    name: t('nameLabel'),
    slug: t('slugLabel'),
    slugHint: kind === 'network' ? t('slugHintNetwork') : t('slugHintShop'),
    slugFixed: t('slugFixedLabel'),
    slugFixedHint: t('slugFixedHint'),
    cancel: t('cancel'),
    submit: mode === 'create' ? t(`${screen}.submitNew`) : t('save'),
    submitting: mode === 'create' ? t(`${screen}.submittingNew`) : t('saving'),
    failedTitle: t('failedTitle'),
    failedBody: t('failedBody'),
    errors: sourceErrorLabels(t, kind, limits),
  };
}

/** The limits of the feed form: the file-name limit and the endings are always given (S3.7). */
export type FeedFormLimits = FormLimits & { fileName: number; fileKinds: string };

/**
 * The strings of the feed form. The feed id and the demo flag matter on an edit only: the
 * confirmation names the feed, and a demonstration feed's domain line reads
 * "Dominio:" where any other reads "Dominio actual:".
 */
export function feedFormLabels(
  t: FormTranslate,
  options: { mode: 'create' | 'edit'; feedId: number; demo: boolean; limits: FeedFormLimits },
): FeedFormLabels {
  const { mode, feedId, demo, limits } = options;
  const creating = mode === 'create';
  return {
    shop: t('Feed.shopLabel'),
    shopPrompt: t('Feed.shopPrompt'),
    shopFixed: t('Feed.shopFixedLabel'),
    network: t('Feed.networkLabel'),
    networkPrompt: t('Feed.networkPrompt'),
    address: creating ? t('Feed.urlLabelNew') : t('Feed.urlLabelEdit'),
    addressHint: creating ? t('Feed.urlHintNew') : t('Feed.urlHintEdit'),
    addressRefill: creating ? t('Feed.refillHintNew') : t('Feed.refillHintEdit'),
    domainLabel: demo ? t('Feed.demoDomainLabel') : t('Feed.currentDomainLabel'),
    warningTitle: t('Feed.warningTitle'),
    warningBody: t('Feed.warningBody'),
    demoHint: t('Feed.demoUrlHint'),
    confirmTitle: t('Feed.confirmTitle', { id: feedId }),
    confirmBody: t('Feed.confirmBody'),
    confirmYes: t('Feed.confirmYes'),
    confirmYesPending: t('Feed.confirmYesPending'),
    source: {
      label: t('Feed.sourceLabel'),
      optionNetwork: t('Feed.sourceOptionNetwork'),
      optionFile: t('Feed.sourceOptionFile'),
      optionCollected: t('Feed.sourceOptionCollected'),
      hintNetwork: t('Feed.sourceHintNetwork'),
      hintFile: t('Feed.sourceHintFile'),
      hintCollected: t('Feed.sourceHintCollected'),
      fixedLabel: t('Feed.sourceFixedLabel'),
      fixedNetwork: t('Feed.sourceFixedNetwork'),
      fixedFile: t('Feed.sourceFixedFile'),
      fixedCollected: t('Feed.sourceFixedCollected'),
    },
    // A collected file is a file source with its own label, hint and warning body (S12.2); the edit hint,
    // the refills and the confirm title are the catalogue file's.
    collected: {
      label: t('Feed.fileLabelCollected'),
      hint: creating
        ? t('Feed.fileHintNewCollected', { kinds: limits.fileKinds })
        : t('Feed.fileHintEdit', { kinds: limits.fileKinds }),
      warningBody: t('Feed.fileWarningBodyCollected'),
      infoTitle: t('Feed.collectedInfoTitle'),
      infoBody: t('Feed.collectedInfoBody'),
    },
    file: {
      label: t('Feed.fileLabel'),
      hint: creating ? t('Feed.fileHintNew', { kinds: limits.fileKinds }) : t('Feed.fileHintEdit', { kinds: limits.fileKinds }),
      refill: creating ? t('Feed.fileRefillNew') : t('Feed.fileRefillEdit'),
      storedUnavailable: t('Feed.fileStoredUnavailable'),
      warningTitle: t('Feed.fileWarningTitle'),
      warningBody: t('Feed.fileWarningBody'),
      confirmTitle: t('Feed.fileConfirmTitle', { id: feedId }),
    },
    missingNetworkTitle: t('Feed.missingNetworkTitle'),
    missingNetworkBody: t('Feed.missingNetworkBody'),
    cancel: t('cancel'),
    submit: creating ? t('Feed.submitNew') : t('save'),
    submitting: creating ? t('Feed.submittingNew') : t('saving'),
    failedTitle: t('failedTitle'),
    failedBody: t('failedBody'),
    errors: sourceErrorLabels(t, 'shop', limits),
  };
}
