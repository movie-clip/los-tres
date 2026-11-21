import { EmptyList } from './EmptyList';
import styles from './ProductOffersSection.module.css';

export type ProductOffersSectionProps = {
  heading: string;
  /** "2 ofertas" or "Sin ofertas". */
  count: string;
  /** The independence and VAT sentence; null when there are no offers. */
  intro: string | null;
  /** Accessible name of the offer list. */
  listLabel: string;
  /** Shown instead of the list when the product has no offers. */
  empty: string | null;
  /** The offer rows, as list items. */
  children: React.ReactNode;
};

/** The offers of a product: heading and count, one sentence, then every offer in a list, or the empty box. No paging. */
export function ProductOffersSection({ heading, count, intro, listLabel, empty, children }: ProductOffersSectionProps) {
  return (
    <section className={styles.section} data-testid="offers-section">
      <div className={styles.head}>
        <h2 className={styles.heading}>{heading}</h2>
        <span className={styles.count} data-testid="offers-count">
          {count}
        </span>
      </div>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
      {empty ? (
        <EmptyList text={empty} testId="offers-empty" />
      ) : (
        <ul className={styles.list} aria-label={listLabel} data-testid="offers-list">
          {children}
        </ul>
      )}
    </section>
  );
}
