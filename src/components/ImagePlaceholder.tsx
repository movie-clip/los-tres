import { CategoryIllustration, type IllustrationKey } from './CategoryIllustration';
import styles from './ImagePlaceholder.module.css';

/**
 * The product image square. With an illustration it holds the category
 * drawing; with null it is the plain grey square. The label arrives as a
 * display string and is the only thing announced.
 */
export function ImagePlaceholder({
  label,
  illustration,
}: {
  label: string;
  illustration: IllustrationKey | null;
}) {
  return (
    <div role="img" aria-label={label} className={styles.placeholder}>
      {illustration ? <CategoryIllustration illustration={illustration} /> : null}
    </div>
  );
}
