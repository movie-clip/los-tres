import styles from './ErrorBlock.module.css';

/**
 * The sign-in failure block. No colour says "error": the 2px dark border, the
 * bold title and the words do. Announced at once; takes no focus.
 */
export function ErrorBlock({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className={styles.block} data-testid="admin-error">
      <span className={styles.title}>{title}</span>
      <span className={styles.message}>{message}</span>
    </div>
  );
}
