import styles from './CategoryTree.module.css';

export type CategoryTreeRow = {
  /** A stable React key, for example the category slug. Never shown. */
  key: string;
  /** Link target, already built: /categoria/<slug>. */
  href: string;
  name: string;
  /** Finished count text, for example "26 productos". */
  count: string;
};

export type CategoryTreeGroupItem = CategoryTreeRow & {
  /** Already in display order. Empty: the group is only its heading row. */
  children: CategoryTreeRow[];
};

export type CategoryTreeProps = {
  /** Already filtered and in display order. The component never sorts. */
  groups: CategoryTreeGroupItem[];
};

/**
 * The home page category groups: a heading link per top-level category, then a
 * row link per child. Display strings only. Plain anchors, no prefetching.
 */
export function CategoryTree({ groups }: CategoryTreeProps) {
  return (
    <ul className={styles.groups} data-testid="category-tree">
      {groups.map(({ key, href, name, count, children }) => (
        <li key={key} className={styles.group} data-testid="category-group">
          <h3 className={styles.heading}>
            <a
              href={href}
              className={`${styles.link} ${styles.headingLink}`}
              data-testid="category-group-link"
            >
              <span className={styles.name}>{name}</span>
              <span className={styles.count} data-testid="category-group-count">
                {count}
              </span>
            </a>
          </h3>
          {children.length > 0 ? (
            <ul className={styles.rows}>
              {children.map((child) => (
                <li key={child.key} className={styles.row} data-testid="category-row">
                  <a href={child.href} className={styles.link} data-testid="category-row-link">
                    <span className={styles.name}>{child.name}</span>
                    <span className={styles.count} data-testid="category-row-count">
                      {child.count}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
