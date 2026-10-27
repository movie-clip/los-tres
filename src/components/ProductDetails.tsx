import type { IllustrationKey } from './CategoryIllustration';
import { ImagePlaceholder } from './ImagePlaceholder';
import styles from './ProductDetails.module.css';

export type ProductDetail = {
  /** Already-translated label, for example "Marca". */
  label: string;
  value: string;
};

export type ProductDetailsProps = {
  title: string;
  imageLabel: string;
  /** The product's own leaf category drawing; null keeps the plain grey square. */
  illustration: IllustrationKey | null;
  /** Only the details that exist: a missing one is left out by the caller. */
  details: ProductDetail[];
  /** Plain text. Rendered as a text node, never as HTML. */
  description: string | null;
};

/** The product heading, image placeholder, identifying details and description. Display strings only. */
export function ProductDetails({
  title,
  imageLabel,
  illustration,
  details,
  description,
}: ProductDetailsProps) {
  return (
    <section className={styles.details}>
      <ImagePlaceholder label={imageLabel} illustration={illustration} />
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {details.length > 0 ? (
          <dl className={styles.list}>
            {details.map((detail) => (
              <div key={detail.label} className={styles.row}>
                <dt className={styles.term}>{detail.label}</dt>
                <dd className={styles.value}>{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {description !== null ? <p>{description}</p> : null}
      </div>
    </section>
  );
}
