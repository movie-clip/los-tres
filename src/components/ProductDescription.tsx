import styles from './ProductDescription.module.css';

export type ProductDescriptionProps = {
  /** Already translated: Product.descriptionHeading. */
  heading: string;
  /** Plain text. Rendered as a text node, never as HTML. */
  text: string;
};

/** The product description in its own card. Display strings only; the page renders it only when a description exists. */
export function ProductDescription({ heading, text }: ProductDescriptionProps) {
  return (
    <section className={styles.description} data-testid="product-description">
      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.text}>{text}</p>
    </section>
  );
}
