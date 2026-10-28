import styles from './OfferList.module.css';

export type OfferRow = {
  /** A stable React key, for example the offer id as text. Never shown. */
  key: string;
  shopName: string;
  /** Formatted price, IVA included, for example "12,99 €". */
  price: string;
  /** Formatted "updated on" line. Always present: the date is never null. */
  updated: string;
  /** Relative path /go/<id>, from goPath(). Never a shop URL. */
  goHref: string;
  /** Visible link text, already translated: Product.goToShopShort. */
  goLabel: string;
  /** The link's accessible name, already translated: Product.goToShop with the shop name. */
  goAccessibleName: string;
  /** From the server read (PublicOffer.isBestPrice). The component never computes it. */
  isBestPrice: boolean;
};

export type OfferListProps = {
  heading: string;
  /** Product.bestPrice, shown in the tag of every row with isBestPrice. */
  bestPriceLabel: string;
  /** Already in display order: cheapest first. The component never sorts. */
  offers: OfferRow[];
};

/**
 * The shops that sell the product. Display strings only. Each row has one plain
 * anchor to its /go path: never next/link (it prefetches), never a target, and
 * no noreferrer, so the redirect can read the source page from the Referer.
 */
export function OfferList({ heading, bestPriceLabel, offers }: OfferListProps) {
  return (
    <section className={styles.offers}>
      <h2 className={styles.heading}>{heading}</h2>
      <ol className={styles.list}>
        {offers.map((offer) => (
          <li key={offer.key} className={styles.row} data-testid="offer-row">
            <div className={styles.shopCell}>
              <span className={styles.shop} data-testid="offer-shop">
                {offer.shopName}
              </span>
              {offer.isBestPrice ? (
                <span className={styles.tag} data-testid="best-price">
                  {bestPriceLabel}
                </span>
              ) : null}
            </div>
            <span className={styles.price} data-testid="offer-price">
              {offer.price}
            </span>
            <span className={styles.updated} data-testid="offer-updated">
              {offer.updated}
            </span>
            <a
              href={offer.goHref}
              rel="sponsored nofollow"
              aria-label={offer.goAccessibleName}
              className={styles.go}
              data-testid="offer-go"
            >
              {offer.goLabel}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
