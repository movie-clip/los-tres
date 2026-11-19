'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';

import type { CategoryActionState } from '@/app/admin/(shell)/categorias/actions';
import type { AdminCategoryRow, CategoryTarget } from '@/server/admin/category-mappings';

import { CategoryResultLine } from './CategoryResultLine';
import { CategoryRow } from './CategoryRow';
import type { ShownResult } from './category-result';
import { useCountText } from './useCountText';
import styles from './CategoryFeedRows.module.css';

type CategoryAction = (previous: CategoryActionState, form: FormData) => Promise<CategoryActionState>;

/** The three server actions, passed down by the page: this component imports nothing from src/server. */
export type CategoryActions = {
  assign: CategoryAction;
  outside: CategoryAction;
  remove: CategoryAction;
};

export type CategoryFeedRowsProps = {
  feedId: number;
  /** "Feed 3 de Tienda Demo Uno", already translated. */
  feedTitle: string;
  /** The reader's rows, already ordered: not reviewed first. Split by state, never re-sorted. */
  rows: AdminCategoryRow[];
  targets: CategoryTarget[];
  actions: CategoryActions;
};

const IDLE: CategoryActionState = { status: 'idle' };

/** Next throws a redirect as an error carrying a NEXT_REDIRECT digest; it is navigation, not a failure. */
function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/**
 * The category rows of one feed in their two groups, and the one action state
 * they share. A button names the action it wants in the form field `intent`;
 * the field is not part of the server contract, which ignores it, and decides
 * only which of the three server actions this call goes to. The page
 * revalidates after a save, so a row can change group and position: the feed
 * keeps the last result and the row it concerns draws it wherever it landed, or
 * the feed draws it when the row no longer exists. A transport failure becomes
 * a failed result instead of reaching the error boundary; Next's own redirect
 * (a session that has ended) is rethrown so it still navigates to sign-in.
 */
export function CategoryFeedRows({ feedId, feedTitle, rows, targets, actions }: CategoryFeedRowsProps) {
  const t = useTranslations('Admin.Categories');
  const formatCount = useCountText();

  const guarded = async (previous: CategoryActionState, form: FormData): Promise<CategoryActionState> => {
    const intent = form.get('intent');
    const feedCategory = form.get('feedCategory');
    const failed: CategoryActionState = {
      status: 'failed',
      feedId,
      feedCategory: typeof feedCategory === 'string' ? feedCategory : null,
    };
    const action = intent === 'assign' ? actions.assign : intent === 'outside' ? actions.outside : intent === 'remove' ? actions.remove : null;
    if (!action) return failed;
    try {
      const result = await action(previous, form);
      return result && typeof result === 'object' ? result : previous;
    } catch (error) {
      if (isNextRedirect(error)) throw error;
      return failed;
    }
  };
  const [state, formAction, pending] = useActionState(guarded, IDLE);

  // The last result stays until the next action on this feed; while one runs the old line is not shown.
  const shown: ShownResult | null = !pending && state.status !== 'idle' ? state : null;
  const concerns = (row: AdminCategoryRow): ShownResult | null =>
    shown !== null && shown.feedCategory === row.feedCategory ? shown : null;
  const feedLevel = shown !== null && !rows.some((row) => row.feedCategory === shown.feedCategory) ? shown : null;

  // A result for a row that no longer exists (a zero-count record was removed) takes focus at the feed level.
  const feedLineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (feedLevel) feedLineRef.current?.focus();
  }, [feedLevel]);

  const pendingRows = rows.filter((row) => row.state.kind === 'not_reviewed');
  const reviewedRows = rows.filter((row) => row.state.kind !== 'not_reviewed');

  const group = (kind: 'pending' | 'reviewed', list: AdminCategoryRow[]) =>
    list.length === 0 ? null : (
      <div className={styles.group} data-testid={`category-group-${kind}`}>
        <h3 className={styles.groupHeading}>
          {t(kind === 'pending' ? 'groupPending' : 'groupReviewed', { count: formatCount(list.length) })}
        </h3>
        <ul
          className={styles.list}
          aria-label={t(kind === 'pending' ? 'rowListLabelPending' : 'rowListLabelReviewed', { feed: feedTitle })}
        >
          {list.map((row) => (
            <CategoryRow
              key={row.feedCategory}
              feedId={feedId}
              row={row}
              targets={targets}
              formAction={formAction}
              version={state}
              result={concerns(row)}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <>
      {feedLevel ? <CategoryResultLine result={feedLevel} ref={feedLineRef} /> : null}
      {group('pending', pendingRows)}
      {group('reviewed', reviewedRows)}
    </>
  );
}
