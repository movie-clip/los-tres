import styles from './OfferList.module.css';

export type OfferRow = {
  /** A stable React key, for example the offer id as text. Never shown. */
  key: string;
  shopName: string;
  /** Formatted price, IVA included, for example "12,99 €". */
  price: string;
  /** Formatted "price updated on" line. */
  updated: string;
  /** Relative path /go/<id>, from goPath(). Never a shop URL. */
  goHref: string;
  /** Link text, already translated: Product.goToShop with the shop name. */
  goLabel: string;
};

export type OfferListProps = {
  heading: string;
  shopCount: string;
  vatNote: string;
  /** Already in display order: cheapest first. The component never sorts. */
  offers: OfferRow[];
};

/**
 * The shops that sell the product. Display strings only. Each row has one plain
 * anchor to its /go path: never next/link (it prefetches), never a target, and
 * no noreferrer, so the redirect can read the source page from the Referer.
 */
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
            <a
              href={offer.goHref}
              rel="sponsored nofollow"
              className={styles.go}
              data-testid="offer-go"
            >
              {offer.goLabel}
            </a>
            <span className={styles.updated} data-testid="offer-updated">
              {offer.updated}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
