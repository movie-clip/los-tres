import type { CategoryActionState } from '@/app/admin/(shell)/categorias/actions';

// The result sentences of the category screen (S4.2, 04-ux section 6). Pure: the caller passes its translator
// and a count formatter, so the same rules serve the row line and the feed line, and a test can drive them with
// a plain translator. A sentence comes from what the server stored, never from what the form sent.

/** A result the screen shows: any action state but the one before the first save. */
export type ShownResult = Exclude<CategoryActionState, { status: 'idle' }>;

/** The translator of `Admin.Categories`, in the one shape this module needs. */
export type CategoryTranslate = (key: string, values?: Record<string, string | number>) => string;

/** The message key of each refusal. The first two belong beside the select; `gone` sits under the row. */
const REFUSAL_KEYS = {
  target_required: 'errorTargetRequired',
  target_invalid: 'errorTargetInvalid',
  gone: 'refusedGone',
} as const;

/** The refusals the select shows beside itself instead of a line under the row. */
export function isTargetRefusal(result: ShownResult | null): result is Extract<ShownResult, { status: 'refused' }> {
  return result?.status === 'refused' && result.reason !== 'gone';
}

/**
 * The sentences of one result, in order: what was done, then how many products it changed when the server
 * returned a count. A failed save has none: the Error block says it.
 */
export function resultSentences(
  result: ShownResult,
  t: CategoryTranslate,
  formatCount: (count: number) => string,
): string[] {
  switch (result.status) {
    case 'saved': {
      const category = result.feedCategory;
      const { stored, previous, productsChanged } = result;
      const done =
        stored.kind === 'mapped'
          ? t('doneMapped', { category, target: stored.targetName })
          : stored.kind === 'outside'
            ? t('doneOutside', { category })
            : t('doneRemoved', { category });
      if (productsChanged === null) return [done];
      if (stored.kind === 'mapped') {
        return [done, t('productsMoved', { count: productsChanged, countText: formatCount(productsChanged), target: stored.targetName })];
      }
      if (previous.kind === 'mapped') {
        return [done, t('productsCleared', { count: productsChanged, countText: formatCount(productsChanged) })];
      }
      return [done];
    }
    case 'unchanged':
      return [t('doneUnchanged', { category: result.feedCategory })];
    case 'refused':
      return [t(REFUSAL_KEYS[result.reason])];
    case 'failed':
      return [];
  }
}
