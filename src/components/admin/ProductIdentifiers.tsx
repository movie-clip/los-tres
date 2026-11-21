import { ValueLine } from './ValueLine';
import styles from './ProductIdentifiers.module.css';

export type ProductIdentifier = {
  /** "Marca:", "Referencia:", "EAN:" or "Identificador:", colon included. */
  label: string;
  value: string;
  testId: string;
};

/**
 * The identifier lines of a product on one wrapping line. The caller passes
 * only the values the product has: an absent one is left out, never blank and
 * never a dash.
 */
export function ProductIdentifiers({ items }: { items: ProductIdentifier[] }) {
  return (
    <div className={styles.line}>
      {items.map((item) => (
        <ValueLine key={item.testId} label={item.label} value={item.value} testId={item.testId} />
      ))}
    </div>
  );
}
