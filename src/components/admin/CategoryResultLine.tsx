'use client';

import { useTranslations } from 'next-intl';
import type { Ref } from 'react';

import { ErrorBlock } from './ErrorBlock';
import { resultSentences, type ShownResult } from './category-result';
import { useCountText } from './useCountText';
import styles from './CategoryResultLine.module.css';

export type CategoryResultLineProps = {
  result: ShownResult;
  /** Where focus goes after a result: the line is focusable but not in the Tab order. Absent for a failed save. */
  ref?: Ref<HTMLDivElement>;
};

/**
 * What the last save did, in one or two sentences under its row, or at the feed
 * level when the row no longer exists. A status that takes focus after a
 * result, so it is read once. A failed save is the Error block, which announces
 * itself and takes no focus. Needs the messages of `Admin.Categories`,
 * `Admin.Sources` and `Admin.Form` from the page's provider.
 */
export function CategoryResultLine({ result, ref }: CategoryResultLineProps) {
  const t = useTranslations('Admin.Categories');
  const tSources = useTranslations('Admin.Sources');
  const tForm = useTranslations('Admin.Form');
  const formatCount = useCountText();

  if (result.status === 'failed') {
    return (
      <div className={styles.error}>
        <ErrorBlock title={tSources('errorTitle')} message={tForm('failedBody')} />
      </div>
    );
  }
  const sentences = resultSentences(result, t, formatCount);
  return (
    <div ref={ref} role="status" tabIndex={-1} className={styles.line} data-testid="category-result">
      {sentences.map((sentence) => (
        <span key={sentence} className={styles.sentence}>
          {sentence}
        </span>
      ))}
    </div>
  );
}
