import Link from 'next/link';

import styles from './SiteHeader.module.css';

/** The site name arrives as a prop: components never read configuration. */
export function SiteHeader({ siteName }: { siteName: string }) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.name} data-testid="site-header-link">
          {siteName}
        </Link>
      </div>
    </header>
  );
}
