import styles from './AdminNav.module.css';

export type AdminNavItem = {
  /** A stable React key, never shown. */
  key: string;
  label: string;
  /** Without a destination the entry is a placeholder: not a link, not focusable (AC 25). */
  href?: string;
  /** The page being shown; only an entry with a destination can be current. */
  current?: boolean;
};

export type AdminNavProps = {
  /** Accessible name of the nav landmark. */
  label: string;
  /** "(próximamente)", read after the label of a placeholder and never painted. */
  comingSoon: string;
  items: AdminNavItem[];
};

/** The admin menu under the header. Display strings only; plain anchors, no prefetch. */
export function AdminNav({ label, comingSoon, items }: AdminNavProps) {
  return (
    <nav className={styles.nav} aria-label={label} data-testid="admin-nav">
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key}>
            {item.href ? (
              <a
                href={item.href}
                className={item.current ? `${styles.item} ${styles.current}` : `${styles.item} ${styles.link}`}
                aria-current={item.current ? 'page' : undefined}
              >
                {item.label}
              </a>
            ) : (
              <span className={`${styles.item} ${styles.placeholder}`} aria-disabled="true">
                {item.label}
                <span className={styles.hidden}> {comingSoon}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
