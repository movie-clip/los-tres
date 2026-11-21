import styles from './ProductBox.module.css';

export type ProductBoxProps = {
  /** "Producto". */
  heading: string;
  /** The hide toggle with the identifier lines. */
  children: React.ReactNode;
};

/** The product's own box on its page: a heading and the toggle, in the shop box look. */
export function ProductBox({ heading, children }: ProductBoxProps) {
  return (
    <section className={styles.box} data-testid="product-box">
      <h2 className={styles.heading}>{heading}</h2>
      {children}
    </section>
  );
}
