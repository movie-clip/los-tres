import styles from './Pagination.module.css';

export type PaginationLink = {
  /** Plain path: the category URL for page 1 (no query), else with ?pagina=<n>. */
  href: string;
  /** Already translated, for example "Anterior". */
  label: string;
};

export type PaginationProps = {
  /** Accessible name of the nav, for example "Paginación". */
  navLabel: string;
  /** Already translated, for example "Página 2 de 6". Plain text, not a link. */
  indicator: string;
  /** Null when there is no previous page: the slot stays empty. */
  previous: PaginationLink | null;
  /** Null when there is no next page: the slot stays empty. */
  next: PaginationLink | null;
};

/**
 * Previous, page indicator, next. Display strings only. Plain anchors that work
 * without script. The caller renders this only when there is more than one page.
 */
export function Pagination({ navLabel, indicator, previous, next }: PaginationProps) {
  return (
    <nav aria-label={navLabel} className={styles.nav} data-testid="pagination">
      {previous !== null ? (
        <a
          href={previous.href}
          rel="prev"
          className={`${styles.link} ${styles.previous}`}
          data-testid="pagination-prev"
        >
          <span aria-hidden="true">←</span>
          {previous.label}
        </a>
      ) : null}
      <span className={styles.indicator} data-testid="pagination-indicator">
        {indicator}
      </span>
      {next !== null ? (
        <a
          href={next.href}
          rel="next"
          className={`${styles.link} ${styles.next}`}
          data-testid="pagination-next"
        >
          {next.label}
          <span aria-hidden="true">→</span>
        </a>
      ) : null}
    </nav>
  );
}
