import styles from './ProductOfferRow.module.css';

export type ProductOfferRowProps = {
  shopName: string;
  /** The price already formatted from integer cents, IVA included, as the public page shows it. */
  price: string;
  /** "Feed 3": feeds have no name. */
  feedLine: string;
  /** The hide toggle of this offer. */
  children: React.ReactNode;
};

/** One offer of a product: shop and price on one line, the feed line, then its toggle. No offer address, no link out. */
export function ProductOfferRow({ shopName, price, feedLine, children }: ProductOfferRowProps) {
  return (
    <li className={styles.row} data-testid="offer-row">
      <div className={styles.head}>
        <h3 className={styles.shop}>{shopName}</h3>
        <span className={styles.price} data-testid="offer-price">
          {price}
        </span>
      </div>
      <span className={styles.feed} data-testid="offer-feed">
        {feedLine}
      </span>
      {children}
    </li>
  );
}
