import styles from './ImagePlaceholder.module.css';

/** One generic placeholder where a product image will go. The label arrives as a display string. */
export function ImagePlaceholder({ label }: { label: string }) {
  return <div role="img" aria-label={label} className={styles.placeholder} />;
}
