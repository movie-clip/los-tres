import styles from './HomeSearch.module.css';

export type HomeSearchProps = {
  /** The visible label of the field: Home.searchLabel. */
  label: string;
  /** The submit button text: Home.searchButton. */
  button: string;
  /**
   * The interim note, finished text, shown under the form. Null renders none.
   * Removed together with the interim mode when the search page lands.
   */
  notice: string | null;
};

/**
 * The home page search: a native GET form that works without JavaScript. The
 * field carries no value and no placeholder, so a typed query is never echoed.
 * Display strings only.
 */
export function HomeSearch({ label, button, notice }: HomeSearchProps) {
  return (
    <div className={styles.search}>
      <form role="search" method="get" action="/" className={styles.form} data-testid="home-search">
        <label htmlFor="home-search-q" className={styles.label}>
          {label}
        </label>
        <div className={styles.row}>
          <input
            id="home-search-q"
            type="search"
            name="q"
            maxLength={100}
            autoComplete="off"
            enterKeyHint="search"
            className={styles.input}
            data-testid="home-search-input"
          />
          <button type="submit" className={styles.button} data-testid="home-search-button">
            {button}
          </button>
        </div>
      </form>
      {notice === null ? null : (
        <p role="status" className={styles.notice} data-testid="home-search-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
