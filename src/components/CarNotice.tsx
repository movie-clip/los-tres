import styles from './CarNotice.module.css';

/**
 * The notice for a page opened with a `coche` the site does not recognise. The page
 * decides when to render it and passes the finished sentence; first child of `main`.
 * No dismissal, so no state and no cookie.
 */
export function CarNotice({ text }: { text: string }) {
  return (
    <p role="note" className={styles.notice} data-testid="car-notice">
      {text}
    </p>
  );
}
