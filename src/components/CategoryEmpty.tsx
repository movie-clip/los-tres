import Link from 'next/link';

import styles from './CategoryEmpty.module.css';

export type CategoryEmptyProps = {
  heading: string;
  body: string;
  /**
   * Link text, already translated: NotFound.backHome. The link goes to the home page.
   * Omitted on the home page itself, where the link paragraph is not rendered.
   */
  homeLabel?: string;
  /**
   * An action link with its own target, for example "Quitar el filtro" back to the
   * clean category URL. Both fields are finished: a label and a path. Omitted when
   * the state has no way out other than the home link.
   */
  action?: { href: string; label: string };
};

/** An empty listing state: no products, or no products for a filter. Display strings only. */
export function CategoryEmpty({ heading, body, homeLabel, action }: CategoryEmptyProps) {
  return (
    <section className={styles.empty} data-testid="category-empty">
      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.text}>{body}</p>
      {action === undefined ? null : (
        <p className={styles.text}>
          <a href={action.href} className={styles.action} data-testid="category-empty-action">
            {action.label}
          </a>
        </p>
      )}
      {homeLabel === undefined ? null : (
        <p className={styles.text}>
          <Link href="/" className={styles.home}>
            {homeLabel}
          </Link>
        </p>
      )}
    </section>
  );
}
