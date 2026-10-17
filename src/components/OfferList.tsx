import styles from './OfferList.module.css';

export type OfferRow = {
  /** A stable React key, for example the offer id as text. Never shown. */
  key: string;
  shopName: string;
  /** Formatted price, IVA included, for example "12,99 €". */
  price: string;
  /** Formatted "price updated on" line. */
  updated: string;
};

export type OfferListProps = {
  heading: string;
  shopCount: string;
  vatNote: string;
  /** Already in display order: cheapest first. The component never sorts. */
  offers: OfferRow[];
};

/** The shops that sell the product. Display strings only; no row links to a shop (D-1 Q4). */
export function OfferList({ heading, shopCount, vatNote, offers }: OfferListProps) {
  return (
    <section className={styles.offers}>
      <h2 className={styles.heading}>{heading}</h2>
      <p data-testid="shop-count">{shopCount}</p>
      <p>{vatNote}</p>
      <ol className={styles.list}>
        {offers.map((offer) => (
          <li key={offer.key} className={styles.row} data-testid="offer-row">
            <span className={styles.shop} data-testid="offer-shop">
              {offer.shopName}
            </span>
            <span className={styles.price} data-testid="offer-price">
              {offer.price}
            </span>
            <span className={styles.updated} data-testid="offer-updated">
              {offer.updated}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
