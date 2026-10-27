import { CategoryIllustration, type IllustrationKey } from './CategoryIllustration';
import styles from './CategoryTiles.module.css';

export type CategoryTile = {
  /** A stable React key, for example the category slug. Never shown. */
  key: string;
  /** Link target, already built: /categoria/<slug>. */
  href: string;
  name: string;
  /** Finished count text, for example "16 productos". */
  count: string;
  /** The category drawing. Null renders the same tile with an empty box. */
  illustration: IllustrationKey | null;
};

export type CategoryTilesProps = {
  /** Already filtered and in display order. The component never sorts. */
  tiles: CategoryTile[];
};

/**
 * The home page category tiles: one link per populated category. Display
 * strings only. Renders nothing for an empty list. Plain anchors, no prefetching.
 * The count is the last span in the link.
 */
export function CategoryTiles({ tiles }: CategoryTilesProps) {
  if (tiles.length === 0) {
    return null;
  }

  return (
    <ul className={styles.tiles} data-testid="category-tiles">
      {tiles.map(({ key, href, name, count, illustration }) => (
        <li key={key} className={styles.tile} data-testid="category-tile">
          <a href={href} className={styles.link} data-testid="category-tile-link">
            <span className={styles.art} aria-hidden="true">
              {illustration ? <CategoryIllustration illustration={illustration} /> : null}
            </span>
            <span className={styles.name} data-testid="category-tile-name">
              {name}
            </span>
            <span className={styles.count} data-testid="category-tile-count">
              {count}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
