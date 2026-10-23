'use client';

import { usePathname } from 'next/navigation';

import styles from './AdminNav.module.css';

export type AdminNavItem = {
  /** A stable React key, never shown. */
  key: string;
  label: string;
  /** Without a destination the entry is a placeholder: not a link, not focusable (AC 25). */
  href?: string;
};

export type AdminNavProps = {
  /** Accessible name of the nav landmark. */
  label: string;
  /** "(próximamente)", read after the label of a placeholder and never painted. */
  comingSoon: string;
  items: AdminNavItem[];
};

/**
 * The entry for the page being shown: its destination equals the path or is a
 * parent of it. `/admin` is the shell's own home and matches only itself, or it
 * would be current on every admin page.
 */
function isCurrent(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The admin menu under the header. Display strings only; plain anchors, no prefetch. The current entry follows the path. */
export function AdminNav({ label, comingSoon, items }: AdminNavProps) {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label={label} data-testid="admin-nav">
      <ul className={styles.list}>
        {items.map((item) => {
          const current = item.href !== undefined && isCurrent(item.href, pathname);
          return (
            <li key={item.key}>
              {item.href ? (
                <a
                  href={item.href}
                  className={current ? `${styles.item} ${styles.current}` : `${styles.item} ${styles.link}`}
                  aria-current={current ? 'page' : undefined}
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
          );
        })}
      </ul>
    </nav>
  );
}
