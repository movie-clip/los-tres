import type { ReactNode } from 'react';

import styles from './CategoryResultsPanel.module.css';

export type CategoryResultsPanelProps = {
  /** The brand filter. Null when the category has fewer than two brands: no group, no hairline. */
  brands: ReactNode | null;
  /** Finished count text, for example "12 productos". It is the data-testid="category-summary" line. */
  count: string;
  /** The sort control. Null when there is nothing to sort (no results). */
  sort: ReactNode | null;
};

/**
 * The white panel above the grid: the brand filter, a hairline, then the count
 * on the left and the sort control on the right. Slots are finished elements;
 * the panel decides only the layout.
 */
export function CategoryResultsPanel({ brands, count, sort }: CategoryResultsPanelProps) {
  return (
    <section className={styles.panel} data-testid="category-panel">
      {brands !== null ? <div className={styles.brands}>{brands}</div> : null}
      <div className={styles.bar}>
        <p className={styles.count} data-testid="category-summary">
          {count}
        </p>
        {sort}
      </div>
    </section>
  );
}
