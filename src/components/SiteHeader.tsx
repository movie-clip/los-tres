import Link from 'next/link';

import { SearchForm, type SearchFormProps } from './SearchForm';
import styles from './SiteHeader.module.css';

/**
 * The site name and the header search form arrive as props: components never
 * read configuration. `search` is null only where a caller wants no box. The
 * box hides itself on a page that carries its own search form (SiteHeader.module.css).
 */
export function SiteHeader({
  siteName,
  search,
}: {
  siteName: string;
  search: SearchFormProps | null;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.name} data-testid="site-header-link">
          {siteName}
        </Link>
        {search === null ? null : (
          <div className={styles.search}>
            <SearchForm {...search} />
          </div>
        )}
      </div>
    </header>
  );
}
