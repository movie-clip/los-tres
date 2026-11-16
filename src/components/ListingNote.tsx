import styles from './ListingNote.module.css';

/**
 * The note that takes the place of the fits group when no listed product fits the
 * selected car (for example "No hay productos compatibles con tu Seat León III 1.6 TDI.").
 * The page decides when to render it and passes the finished sentence; it sits between
 * the results panel and the first group. Not dismissible, so no state.
 */
export function ListingNote({ text }: { text: string }) {
  return (
    <p role="note" className={styles.note} data-testid="listing-note">
      {text}
    </p>
  );
}
