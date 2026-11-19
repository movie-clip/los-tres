'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import type { AdminCategoryRow, CategoryTarget } from '@/server/admin/category-mappings';

import { ActionButton } from './ActionButton';
import { CategoryButton, type CategoryIntent } from './CategoryButton';
import { CategoryResultLine } from './CategoryResultLine';
import { CategorySelect } from './CategorySelect';
import { CategoryStateTag } from './CategoryStateTag';
import { ConfirmPanel } from './ConfirmPanel';
import { isTargetRefusal, type ShownResult } from './category-result';
import { useCountText } from './useCountText';
import styles from './CategoryRow.module.css';

/** The two actions that take products off the site and so ask first. */
type ConfirmKind = 'outside' | 'remove';

/** The test id of the button that opens each confirm, so closing it can return focus there. */
const OPENER_TEST_ID = { outside: 'category-mark-outside', remove: 'category-remove' } as const;

export type CategoryRowProps = {
  feedId: number;
  row: AdminCategoryRow;
  /** The five categories of the site, in tree order. */
  targets: CategoryTarget[];
  /** The feed's one form action. */
  formAction: (form: FormData) => void;
  /** The feed's latest action state, as an identity: a confirm is open only for the state it was opened in. */
  version: unknown;
  /** The result of the last save when it concerns this row, else null. */
  result: ShownResult | null;
};

/**
 * One feed category: its name, how many products it holds, its state, a select
 * of the five site categories and the buttons its state allows. Marking outside
 * and removing an assigned row open an inline confirm first, because they take
 * products off the public site. The tag and the select follow what the server
 * stored (the row's props), never what the form sent. Escapes the feed text
 * like any other: it is rendered as text and sent back in a hidden input only.
 */
export function CategoryRow({ feedId, row, targets, formAction, version, result }: CategoryRowProps) {
  const t = useTranslations('Admin.Categories');
  const tForm = useTranslations('Admin.Form');
  const formatCount = useCountText();
  const rowId = useId();
  const nameId = `${rowId}-name`;
  const { feedCategory, productCount, state } = row;

  // A confirm is open only for the state it was opened in: any new result closes it.
  const [opened, setOpened] = useState<{ version: unknown; kind: ConfirmKind } | null>(null);
  const confirming = opened !== null && opened.version === version ? opened.kind : null;
  const slotRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef<ConfirmKind | null>(null);

  // The select starts on the stored target. A legacy target outside the five has no option, so it starts on the prompt.
  const defaultValue = state.kind === 'mapped' && targets.some((target) => target.id === state.targetId) ? String(state.targetId) : '';

  // Focus is never lost: into the panel on "Cancelar" when it opens, and back to the button that opened it when it closes.
  useEffect(() => {
    if (confirming) {
      slotRef.current?.querySelector('button')?.focus();
    } else if (wasConfirming.current) {
      slotRef.current?.querySelector<HTMLElement>(`[data-testid="${OPENER_TEST_ID[wasConfirming.current]}"]`)?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  // After a result focus goes to the select when it was refused, else to the result line. A saved row may have
  // moved to the other group and been mounted again: this runs on that mount too. React resets an uncontrolled
  // select to its first default after an action, so the select is set again to the stored target.
  useEffect(() => {
    if (!result) return;
    const select = formRef.current?.querySelector('select');
    if (select) select.value = defaultValue;
    if (isTargetRefusal(result)) select?.focus();
    else lineRef.current?.focus();
  }, [result, defaultValue]);

  const refusal = isTargetRefusal(result) ? result.reason : null;
  const selectError =
    refusal === 'target_required' ? t('errorTargetRequired') : refusal === 'target_invalid' ? t('errorTargetInvalid') : undefined;

  const tagLabel =
    state.kind === 'mapped' ? t('tagMapped', { target: state.targetName }) : state.kind === 'outside' ? t('tagOutside') : t('tagPending');
  const values = { category: feedCategory };
  const close = () => setOpened(null);

  const hidden = (
    <>
      <input type="hidden" name="feedId" value={feedId} />
      <input type="hidden" name="feedCategory" value={feedCategory} />
    </>
  );
  const buttonLabels = (intent: CategoryIntent, kind: 'assign' | 'change' | 'markOutside' | 'removeMapped' | 'removeOutside') => ({
    intent,
    label: t(kind),
    pendingLabel: tForm('saving'),
    ariaLabel: t(`${kind}Name`, values),
  });

  return (
    <li className={styles.row} data-testid="category-row">
      <div className={styles.info}>
        <strong id={nameId} className={styles.name} data-testid="category-name">
          {feedCategory}
        </strong>
        <span className={styles.meta}>
          <span className={styles.count} data-testid="category-count">
            {t('rowCount', { count: productCount, countText: formatCount(productCount) })}
          </span>
          <CategoryStateTag kind={state.kind} label={tagLabel} testId="category-tag" />
        </span>
        {productCount === 0 ? (
          <span className={styles.note} data-testid="category-zero-note">
            {t('rowCountZero')}
          </span>
        ) : null}
      </div>
      <div ref={slotRef} className={styles.slot}>
        {confirming ? (
          <form action={formAction}>
            {hidden}
            <input type="hidden" name="intent" value={confirming} />
            <ConfirmPanel
              title={confirming === 'remove' ? t('confirmRemoveTitle', values) : t('confirmOutsideTitle', values)}
              body={t('confirmBody', {
                target: state.kind === 'mapped' ? state.targetName : '',
                count: productCount,
                countText: formatCount(productCount),
              })}
              cancelLabel={tForm('cancel')}
              confirmLabel={confirming === 'remove' ? t('confirmRemoveYes') : t('confirmOutsideYes')}
              confirmPendingLabel={tForm('saving')}
              onCancel={close}
              testId="category-confirm"
            />
          </form>
        ) : (
          <form ref={formRef} action={formAction} className={styles.controls}>
            {hidden}
            <div className={styles.select}>
              <CategorySelect
                id={`${rowId}-select`}
                name="target"
                label={t('selectLabel')}
                labelledBy={nameId}
                prompt={t('selectPrompt')}
                options={targets.map((target) => ({ value: String(target.id), label: target.name }))}
                defaultValue={defaultValue}
                error={selectError}
              />
            </div>
            <div className={styles.buttons}>
              {state.kind === 'not_reviewed' ? (
                <>
                  <CategoryButton variant="filled" testId="category-assign" {...buttonLabels('assign', 'assign')} />
                  <CategoryButton variant="outlined" testId="category-mark-outside" {...buttonLabels('outside', 'markOutside')} />
                </>
              ) : null}
              {state.kind === 'mapped' ? (
                <>
                  <CategoryButton variant="filled" testId="category-change" {...buttonLabels('assign', 'change')} />
                  <ActionButton
                    label={t('markOutside')}
                    ariaLabel={t('markOutsideName', values)}
                    onClick={() => setOpened({ version, kind: 'outside' })}
                    testId={OPENER_TEST_ID.outside}
                  />
                  <ActionButton
                    label={t('removeMapped')}
                    ariaLabel={t('removeMappedName', values)}
                    onClick={() => setOpened({ version, kind: 'remove' })}
                    testId={OPENER_TEST_ID.remove}
                  />
                </>
              ) : null}
              {state.kind === 'outside' ? (
                <>
                  <CategoryButton variant="filled" testId="category-assign" {...buttonLabels('assign', 'assign')} />
                  <CategoryButton variant="outlined" testId="category-unmark" {...buttonLabels('remove', 'removeOutside')} />
                </>
              ) : null}
            </div>
          </form>
        )}
      </div>
      {result && !refusal ? <CategoryResultLine result={result} ref={lineRef} /> : null}
    </li>
  );
}
