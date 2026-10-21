import styles from './DemoNotice.module.css';

/**
 * The notice for a page that lists only demo offers. The page decides when to
 * render it; the component knows nothing about demo data. No dismissal, so no
 * state to remember and no cookie.
 */
export function DemoNotice({ text }: { text: string }) {
  return (
    <p role="note" className={styles.notice}>
      {text}
    </p>
  );
}
