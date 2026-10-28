import styles from './Breadcrumb.module.css';

export type BreadcrumbItem = {
  /** Display text, for example a category name. */
  name: string;
  /** Relative path the crumb links to. */
  href: string;
};

export type BreadcrumbProps = {
  /** Already-translated accessible name of the nav. */
  label: string;
  /** Root first. The current page is not listed. */
  items: BreadcrumbItem[];
};

/**
 * A trail of links, root first. Display strings only. The separator is a
 * drawn chevron on the stylesheet side, so it is not in the DOM or read aloud.
 * Renders nothing when there are no items.
 */
export function Breadcrumb({ label, items }: BreadcrumbProps) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className={styles.nav} data-testid="breadcrumb">
      <ol className={styles.list}>
        {items.map((item) => (
          <li key={item.href} className={styles.item}>
            <a href={item.href} className={styles.link}>
              {item.name}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
