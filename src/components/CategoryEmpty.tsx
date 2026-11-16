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
   * The home link target, finished: `/` or `/?coche=<slug>` (S5.7). Defaults to `/`. A plain
   * anchor, not next/link, so a change of car is always a full load (D8).
   */
  homeHref?: string;
  /**
   * An action link with its own target, for example "Quitar el filtro" back to the
   * clean category URL. Both fields are finished: a label and a path. Omitted when
   * the state has no way out other than the home link.
   */
  action?: { href: string; label: string };
};

/** An empty listing state: no products, or no products for a filter. Display strings only. */
export function CategoryEmpty({
  heading,
  body,
  homeLabel,
  homeHref = '/',
  action,
}: CategoryEmptyProps) {
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
          <a href={homeHref} className={styles.home}>
            {homeLabel}
          </a>
        </p>
      )}
    </section>
  );
}
