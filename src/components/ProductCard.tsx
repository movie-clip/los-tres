import { useId } from 'react';

import { CategoryIllustration, type IllustrationKey } from './CategoryIllustration';
import { FitMark, type FitMarkKind } from './FitMark';
import styles from './ProductCard.module.css';

export type ProductCardProps = {
  /** Relative path /producto/<slug>. Never a shop or /go link: a card has one link. */
  href: string;
  title: string;
  /** Left out entirely when null: no placeholder, no empty line. */
  brand: string | null;
  /** The spec line, for example "Ref. OC-1234". Left out entirely when null. */
  spec: string | null;
  /** The "Desde" label. Null when the product has one shop. */
  priceFrom: string | null;
  /** Formatted lowest price, IVA included, for example "11,49 €". */
  price: string;
  /** Formatted shop count, for example "2 tiendas". */
  shopCount: string;
  /** The product's own leaf category drawing. Null renders the same tile, empty. */
  illustration: IllustrationKey | null;
  /**
   * The fit mark under the spec line, with its finished words. Null or omitted for no mark:
   * no car, or a card with no compatibility data.
   */
  fit?: { kind: FitMarkKind; label: string } | null;
  /**
   * The title's heading level: 3 when the card sits inside a listing group (h1, h2 group
   * heading, h3 title), 2 otherwise, which is the default.
   */
  headingLevel?: 2 | 3;
};

/**
 * One product in a listing. Display strings only. The title link is stretched
 * over the whole card, so the card is a single tab stop. The price is a span,
 * never a paragraph (the .page p rule in globals.css would recolour it).
 * Reading order: drawing, brand, title, spec line, fit mark, price group, shop
 * chip. The title link is described by the mark, so a screen reader hears both.
 */
export function ProductCard({
  href,
  title,
  brand,
  spec,
  priceFrom,
  price,
  shopCount,
  illustration,
  fit = null,
  headingLevel = 2,
}: ProductCardProps) {
  const markId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <li className={styles.card} data-testid="category-card">
      <div className={styles.head}>
        <span className={styles.tile} aria-hidden="true" data-testid="card-tile">
          {illustration ? <CategoryIllustration illustration={illustration} /> : null}
        </span>
        <div className={styles.text}>
          {brand !== null ? (
            <span className={styles.brand} data-testid="card-brand">
              {brand}
            </span>
          ) : null}
          <Heading className={styles.title}>
            <a
              href={href}
              className={styles.link}
              aria-describedby={fit === null ? undefined : markId}
              data-testid="card-title"
            >
              {title}
            </a>
          </Heading>
          {spec !== null ? (
            <span className={styles.spec} data-testid="card-spec">
              {spec}
            </span>
          ) : null}
          {fit === null ? null : <FitMark kind={fit.kind} label={fit.label} id={markId} />}
        </div>
      </div>
      <div className={styles.footer}>
        <span className={styles.priceGroup}>
          {priceFrom !== null ? (
            <span className={styles.from} data-testid="card-price-from">
              {priceFrom}
            </span>
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
