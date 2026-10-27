import { CategoryIllustration, type IllustrationKey } from './CategoryIllustration';
import styles from './ProductCard.module.css';

export type ProductCardProps = {
  /** Relative path /producto/<slug>. Never a shop or /go link: a card has one link. */
  href: string;
  title: string;
  /** Left out entirely when null: no placeholder, no empty line. */
  brand: string | null;
  /** The "Desde" label. Null when the product has one shop. */
  priceFrom: string | null;
  /** Formatted lowest price, IVA included, for example "11,49 €". */
  price: string;
  /** Formatted shop count, for example "2 tiendas". */
  shopCount: string;
  /** The product's own leaf category drawing. Null renders the same tile, empty. */
  illustration: IllustrationKey | null;
};

/**
 * One product in a listing. Display strings only. The title link is stretched
 * over the whole card, so the card is a single tab stop. The price is a span,
 * never a paragraph (the .page p rule in globals.css would recolour it).
 */
export function ProductCard({
  href,
  title,
  brand,
  priceFrom,
  price,
  shopCount,
  illustration,
}: ProductCardProps) {
  return (
    <li className={styles.card} data-testid="category-card">
      <div className={styles.head}>
        <span className={styles.tile} aria-hidden="true" data-testid="card-tile">
          {illustration ? <CategoryIllustration illustration={illustration} /> : null}
        </span>
        <div className={styles.text}>
          <h2 className={styles.title}>
            <a href={href} className={styles.link} data-testid="card-title">
              {title}
            </a>
          </h2>
          {brand !== null ? (
            <span className={styles.brand} data-testid="card-brand">
              {brand}
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.footer}>
        <span className={styles.priceGroup}>
          {priceFrom !== null ? (
            <>
              <span className={styles.from} data-testid="card-price-from">
                {priceFrom}
              </span>{' '}
            </>
          ) : null}
          <span className={styles.price} data-testid="card-price">
            {price}
          </span>
        </span>
        <span className={styles.shops} data-testid="card-shop-count">
          {shopCount}
        </span>
      </div>
    </li>
  );
}
