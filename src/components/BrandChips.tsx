import styles from './BrandChips.module.css';

export type BrandChip = {
  /** A stable React key, for example the brand slug. Never shown. */
  key: string;
  /** Link target, already built with categoryListingPath. */
  href: string;
  /** The brand as displayed. */
  label: string;
  /** Formatted product count, for example "8". */
  count: string;
  /** The full accessible name; it begins with the visible brand name. */
  ariaLabel: string;
  selected: boolean;
};

/** One chip list: the chips in the row, the rest behind the "more" control. */
export type BrandChipList = {
  /** The chips shown in the row. */
  chips: BrandChip[];
  /** The chips behind the "more" control. Empty renders no control. */
  moreChips: BrandChip[];
  /** Summary text of the "more" control, for example "Más marcas (7)". */
  moreLabel: string;
};

export type BrandChipsProps = {
  /** Visible label of the group, for example "Marca". */
  groupLabel: string;
  /** The first chip: every brand. Selected when no brand is. */
  all: { href: string; label: string; selected: boolean };
  /** The list shown below 40rem. */
  narrow: BrandChipList;
  /** The list shown from 40rem. */
  wide: BrandChipList;
};

/** How many brand chips sit in the row from 40rem up before the rest go behind the "more" control. */
export const VISIBLE_BRAND_CHIPS = 8;

/** The same, below 40rem, where the first screen of a category has to reach the first product. */
export const NARROW_BRAND_CHIPS = 2;

const GROUP_LABEL_ID = 'brand-chips-label';

function Chip({ chip }: { chip: BrandChip }) {
  return (
    <li>
      <a
        href={chip.href}
        className={chip.selected ? `${styles.chip} ${styles.selected}` : styles.chip}
        aria-label={chip.ariaLabel}
        aria-current={chip.selected ? 'true' : undefined}
        data-testid="brand-chip"
      >
        {chip.selected ? <span className={styles.check} aria-hidden="true" /> : null}
        <span className={styles.name}>{chip.label}</span>
        <span className={styles.count}>{chip.count}</span>
      </a>
    </li>
  );
}

function ChipList({ all, list }: { all: BrandChipsProps['all']; list: BrandChipList }) {
  // Each list opens on its own: the selected chip may sit in the row of one and behind "more" in the other.
  const moreOpen = list.moreChips.some((chip) => chip.selected);
  return (
    <ul className={styles.list} aria-labelledby={GROUP_LABEL_ID}>
      <li>
        <a
          href={all.href}
          className={all.selected ? `${styles.chip} ${styles.selected}` : styles.chip}
          aria-current={all.selected ? 'true' : undefined}
          data-testid="brand-chip-all"
        >
          {all.selected ? <span className={styles.check} aria-hidden="true" /> : null}
          <span className={styles.name}>{all.label}</span>
        </a>
      </li>
      {list.chips.map((chip) => (
        <Chip key={chip.key} chip={chip} />
      ))}
      {list.moreChips.length > 0 ? (
        <li className={styles.more}>
          <details open={moreOpen} className={styles.details} data-testid="brand-more">
            <summary className={styles.summary}>
              <span className={styles.name}>{list.moreLabel}</span>
              <span className={styles.chevron} aria-hidden="true" />
            </summary>
            <ul className={styles.list}>
              {list.moreChips.map((chip) => (
                <Chip key={chip.key} chip={chip} />
              ))}
            </ul>
          </details>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The brand filter: a labelled list of links, one selected at most, "all
 * brands" first. The overflow is a native details element, open when the
 * selected chip is inside it, so no script is needed. The group renders two
 * lists, a short one below 40rem and a long one from 40rem; the stylesheet
 * hides the other with display none, so it is out of the accessibility tree
 * and the Tab order. Display strings only.
 */
export function BrandChips({ groupLabel, all, narrow, wide }: BrandChipsProps) {
  return (
    <div className={styles.group} data-testid="brand-chips">
      <span id={GROUP_LABEL_ID} className={styles.label}>
        {groupLabel}
      </span>
      <div className={styles.narrow} data-testid="brand-chips-narrow">
        <ChipList all={all} list={narrow} />
      </div>
      <div className={styles.wide} data-testid="brand-chips-wide">
        <ChipList all={all} list={wide} />
      </div>
    </div>
  );
}
