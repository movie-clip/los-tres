import type { IllustrationKey } from './CategoryIllustration';
import { ImagePlaceholder } from './ImagePlaceholder';
import styles from './ProductHero.module.css';

export type ProductDetail = {
  /** Already-translated label, for example "Referencia". */
  label: string;
  value: string;
};

export type ProductHeroProps = {
  title: string;
  /** Null renders no brand line. */
  brand: string | null;
  imageLabel: string;
  /** The product's own leaf category drawing; null keeps the plain grey square. */
  illustration: IllustrationKey | null;
  /** Only the details that exist: a missing one is left out by the caller. Empty renders no list. */
  details: ProductDetail[];
  /** "Desde", or null when fewer than two shops sell the product. */
  priceLabel: string | null;
  /** Formatted lowest price, IVA included, for example "10,49 €". */
  price: string;
  /** Already pluralised, for example "4 tiendas". */
  shopCount: string;
  /** "Precios con IVA incluido." The only place the page says it. */
  vatNote: string;
};

/**
 * What identifies the product and its headline price: image, brand line,
 * title, identifying details, lowest price, shop count and the VAT note.
 * Display strings only; the page formats the price and picks the label.
 */
export function ProductHero({
  title,
  brand,
  imageLabel,
  illustration,
  details,
  priceLabel,
  price,
  shopCount,
  vatNote,
}: ProductHeroProps) {
  return (
    <section className={styles.hero}>
      <div className={styles.head}>
        <div className={styles.image}>
          <ImagePlaceholder label={imageLabel} illustration={illustration} />
        </div>
        <div className={styles.titleBlock}>
          {brand !== null ? (
            <span className={styles.brand} data-testid="product-brand">
              {brand}
            </span>
          ) : null}
          <h1 className={styles.title}>{title}</h1>
        </div>
        {details.length > 0 ? (
          <dl className={styles.details}>
            {details.map((detail) => (
              <div key={detail.label} className={styles.row}>
                <dt className={styles.term}>{detail.label}</dt>
                <dd className={styles.value}>{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className={styles.summary}>
        <div className={styles.priceRow}>
          <div className={styles.priceGroup}>
            {priceLabel !== null ? <span className={styles.from}>{priceLabel}</span> : null}
            <span className={styles.price} data-testid="product-price">
              {price}
            </span>
          </div>
          <span className={styles.shops} data-testid="shop-count">
            {shopCount}
          </span>
        </div>
        <p className={styles.vat}>{vatNote}</p>
      </div>
    </section>
  );
}
