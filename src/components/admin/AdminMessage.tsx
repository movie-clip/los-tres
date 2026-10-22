import styles from './AdminMessage.module.css';

export type AdminMessageProps = {
  heading: string;
  /** A muted sentence under the heading. */
  body: string;
  /** An optional way out: a plain anchor (a full navigation, never a prefetch). */
  link?: { href: string; label: string };
};

/** A heading, a muted sentence and at most one link, in the page column. Landing, not-found and failure screens. */
export function AdminMessage({ heading, body, link }: AdminMessageProps) {
  return (
    <main className="page">
      <h1 className={styles.heading}>{heading}</h1>
      <p>{body}</p>
      {link ? (
        <p>
          <a href={link.href}>{link.label}</a>
        </p>
      ) : null}
    </main>
  );
}
