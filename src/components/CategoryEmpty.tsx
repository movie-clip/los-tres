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
  action?: EmptyAction;
  /**
   * A second action, rendered after `action` in the same row (from 40rem; stacked below).
   * Used by the all-left-out state: "Quitar el filtro", then "Cambiar de coche".
   * Ignored when `action` is omitted.
   */
  secondAction?: EmptyAction;
};

/** A finished action link. `testId` defaults to category-empty-action (second: category-empty-second-action). */
export type EmptyAction = { href: string; label: string; testId?: string };

/** An empty listing state: no products, or no products for a filter. Display strings only. */
export function CategoryEmpty({
  heading,
  body,
  homeLabel,
  homeHref = '/',
  action,
  secondAction,
}: CategoryEmptyProps) {
  const first =
    action === undefined ? null : (
      <p className={styles.text}>
        <a
          href={action.href}
          className={styles.action}
          data-testid={action.testId ?? 'category-empty-action'}
        >
          {action.label}
        </a>
      </p>
    );
  const second =
    action === undefined || secondAction === undefined ? null : (
      <p className={styles.text}>
        <a
          href={secondAction.href}
          className={styles.action}
          data-testid={secondAction.testId ?? 'category-empty-second-action'}
        >
          {secondAction.label}
        </a>
      </p>
    );
  return (
    <section className={styles.empty} data-testid="category-empty">
      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.text}>{body}</p>
      {second === null ? (
        first
      ) : (
        <div className={styles.actions}>
          {first}
          {second}
        </div>
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
