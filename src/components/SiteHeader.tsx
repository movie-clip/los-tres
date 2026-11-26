import { CarControl, type CarControlProps } from './CarControl';
import { SearchForm, type SearchFormProps } from './SearchForm';
import styles from './SiteHeader.module.css';
import { ThemeSwitch } from './ThemeSwitch';

/**
 * The site name and the header search form arrive as props: components never
 * read configuration. `search` is null only where a caller wants no box. The
 * box hides itself on a page that carries its own search form (SiteHeader.module.css).
 * `car` is the car control (S5.7); null or absent draws none, as on the picker page, which
 * is the picker itself. With no car selected the control is the last item of row 1; with
 * a car selected it is row 2. `homeHref` is the site-name link target, finished by the
 * caller (`/` or `/?coche=<slug>`); a plain anchor, so a change of car is a full load (D8).
 * `themeLabel` is the theme switch's accessible name (#398); absent draws no switch. The
 * inline car control and the switch share one trailing group, so they wrap as a unit.
 */
export function SiteHeader({
  siteName,
  search,
  car = null,
  homeHref = '/',
  themeLabel,
}: {
  siteName: string;
  search: SearchFormProps | null;
  car?: CarControlProps | null;
  homeHref?: string;
  themeLabel?: string;
}) {
  const carInline = car !== null && car.car === null;
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <a className={styles.name} data-testid="site-header-link" href={homeHref}>
          {siteName}
        </a>
        {search === null ? null : (
          <div className={styles.search}>
            <SearchForm {...search} />
          </div>
        )}
        {!carInline && themeLabel === undefined ? null : (
          <div className={styles.trailing}>
            {carInline ? (
              <div className={styles.carInline}>
                <CarControl {...car} />
              </div>
            ) : null}
            {themeLabel === undefined ? null : <ThemeSwitch label={themeLabel} />}
          </div>
        )}
      </div>
      {car === null || car.car === null ? null : (
        <div className={styles.carRow}>
          <CarControl {...car} />
        </div>
      )}
    </header>
  );
}
