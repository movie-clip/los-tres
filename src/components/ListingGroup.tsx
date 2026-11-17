import { useId, type ReactNode } from 'react';

import styles from './ListingGroup.module.css';

/**
 * Which group a listed card belongs to under a selected car. The same three values
 * the loaders put in `fitGroup` (src/server/catalogue/fit-listing.ts); redefined
 * here because a component never imports src/server.
 */
export type ListingGroupKind = 'fits' | 'unknown' | 'no-fit-exact';

export type ListingGroupProps = {
  /** Which group this is; read by tests as data-group, never shown. */
  group: ListingGroupKind;
  /** The finished heading, for example "Compatibles con tu Seat León III 1.6 TDI". */
  heading: string;
  /** The one-line explanation under the heading. Omitted (null) for the fits group. */
  help?: string | null;
  /** The card grid of the group. */
  children: ReactNode;
};

/**
 * A run of cards of one group, in the order the listing gave them: cards that
 * follow each other with the same group form one run. A group that has no card on
 * the page yields no run, so it has no heading. The page renders one ListingGroup
 * per run. Generic: the category page and the search page share it.
 */
export function groupRuns<T>(
  items: T[],
  groupOf: (item: T) => ListingGroupKind,
): { group: ListingGroupKind; items: T[] }[] {
  const runs: { group: ListingGroupKind; items: T[] }[] = [];
  for (const item of items) {
    const group = groupOf(item);
    const last = runs[runs.length - 1];
    if (last !== undefined && last.group === group) last.items.push(item);
    else runs.push({ group, items: [item] });
  }
  return runs;
}

/**
 * One group of a listing under a selected car: a section named by its heading (h2),
 * an optional explanation, then the cards. The heading repeats on every page where
 * the group has a card, so the page renders it only when there is one. Display
 * strings only; not interactive.
 */
export function ListingGroup({ group, heading, help = null, children }: ListingGroupProps) {
  const headingId = useId();
  return (
    <section
      className={styles.group}
      aria-labelledby={headingId}
      data-testid="listing-group"
      data-group={group}
    >
      <h2
        id={headingId}
        className={help === null ? styles.heading : `${styles.heading} ${styles.withHelp}`}
        data-testid="listing-group-heading"
      >
        {heading}
      </h2>
      {help === null ? null : (
        <p className={styles.help} data-testid="listing-group-help">
          {help}
        </p>
      )}
      {children}
    </section>
  );
}
