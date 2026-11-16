import type { ListingGroupKind } from './ListingGroup';
import styles from './FitMark.module.css';

/** The two marks a card can carry. A no-data card carries none. */
export type FitMarkKind = 'fits' | 'no-fit';

export type FitMarkProps = {
  kind: FitMarkKind;
  /** The finished words, for example "Compatible". Always shown: colour is never the only cue. */
  label: string;
  /** Unique in the page: the card's link points at it with aria-describedby. */
  id: string;
};

/**
 * The mark a card carries for its group: fits is Compatible, an exact-code hit that
 * does not fit is No compatible, no data has none. Shared by the category and
 * search pages, so the mapping lives here.
 */
export function fitMarkKind(group: ListingGroupKind | null): FitMarkKind | null {
  if (group === 'fits') return 'fits';
  if (group === 'no-fit-exact') return 'no-fit';
  return null;
}

/**
 * A tag of the card's text column: a glyph, then the words. Not interactive and not
 * focusable; the glyph is decorative. Display strings only.
 */
export function FitMark({ kind, label, id }: FitMarkProps) {
  return (
    <span
      id={id}
      className={`${styles.mark} ${kind === 'fits' ? styles.fits : styles.noFit}`}
      data-testid="fit-mark"
      data-fit={kind}
    >
      <span className={styles.glyph} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
