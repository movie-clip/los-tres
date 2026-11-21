import { ProductIdentifiers, type ProductIdentifier } from './ProductIdentifiers';
import { ProductState, type ProductStateProps } from './ProductState';
import { TextLink } from './TextLink';
import styles from './ProductRow.module.css';

export type ProductRowProps = {
  /** The product's admin page, built by the page from the list's own query. */
  href: string;
  title: string;
  state: Omit<ProductStateProps, 'testIdPrefix'>;
  /** Only the identifiers the product has. */
  identifiers: ProductIdentifier[];
};

/**
 * One product of the list: its title as the row's one link, its two facts and
 * its identifiers. No control: hiding lives on the product page.
 */
export function ProductRow({ href, title, state, identifiers }: ProductRowProps) {
  return (
    <li className={styles.row} data-testid="product-row">
      <h2 className={styles.title}>
        <TextLink href={href} label={title} testId="product-row-title" />
      </h2>
      <ProductState {...state} testIdPrefix="product-row" />
      <ProductIdentifiers items={identifiers} />
    </li>
  );
}
