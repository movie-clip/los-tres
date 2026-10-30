import Link from 'next/link';

import { CarControl, type CarControlProps } from './CarControl';
import { SearchForm, type SearchFormProps } from './SearchForm';
import styles from './SiteHeader.module.css';

/**
 * The site name and the header search form arrive as props: components never
 * read configuration. `search` is null only where a caller wants no box. The
 * box hides itself on a page that carries its own search form (SiteHeader.module.css).
 * `car` is the car control of the second row (S5.7); null or absent draws no row, as on
 * the picker page, which is the picker itself.
 */
export function SiteHeader({
  siteName,
  search,
  car = null,
}: {
  siteName: string;
  search: SearchFormProps | null;
  car?: CarControlProps | null;
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
      {car === null ? null : (
        <div className={styles.carRow}>
          <CarControl {...car} />
        </div>
      )}
    </header>
  );
}
