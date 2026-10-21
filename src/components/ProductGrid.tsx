import { ProductCard, type ProductCardProps } from './ProductCard';
import styles from './ProductGrid.module.css';

export type ProductGridItem = ProductCardProps & {
  /** A stable React key, for example the product slug. Never shown. */
  key: string;
};

export type ProductGridProps = {
  /** Already in display order. The component never sorts. */
  cards: ProductGridItem[];
};

/** The cards of one listing page, in a responsive grid. Display strings only. */
export function ProductGrid({ cards }: ProductGridProps) {
  return (
    <ul className={styles.grid}>
      {cards.map(({ key, ...card }) => (
        <ProductCard key={key} {...card} />
      ))}
    </ul>
  );
}
