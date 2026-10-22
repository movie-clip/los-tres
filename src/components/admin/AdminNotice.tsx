import styles from './AdminNotice.module.css';

/**
 * An info notice above the sign-in form: the demo-notice look (grey outline,
 * blue left rule). Announced politely; takes no focus. A div, so the
 * paragraph colour rule in globals.css does not apply.
 */
export function AdminNotice({ text }: { text: string }) {
  return (
    <div role="status" className={styles.notice} data-testid="admin-notice">
      {text}
    </div>
  );
}
