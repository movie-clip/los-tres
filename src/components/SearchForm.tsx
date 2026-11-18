import styles from './SearchForm.module.css';

export type SearchFormVariant = 'hero' | 'page' | 'header';

export type SearchFormProps = {
  /** hero: the home band; page: the /buscar panel; header: the site header (T5.4.5). */
  variant: SearchFormVariant;
  /** Where the form submits: SEARCH_PATH, passed by the page. */
  action: string;
  /** Search.formLabel: the accessible name of the role="search" landmark. */
  formLabel: string;
  /** Visible label on hero and page; the accessible name of the field on header. */
  fieldLabel: string;
  /** The submit button text. */
  button: string;
  /** Finished hint text tied to the field by aria-describedby. Null renders none (header). */
  hint: string | null;
  /** The cleaned term, page variant only. Hero and header never echo a term. */
  value: string | null;
  /**
   * The selected car's slug (S5.7). When set the form submits one hidden `coche` field, so the
   * choice survives the search without script; null or omitted adds none.
   */
  car?: string | null;
  /**
   * The field's placeholder. Only the header form passes one; null or omitted renders no
   * placeholder attribute. Never the term.
   */
  placeholder?: string | null;
};

// Test ids per presentation. The hero keeps the ids the home page always had.
const TEST_IDS: Record<SearchFormVariant, { form: string; input: string; button: string }> = {
  hero: { form: 'home-search', input: 'home-search-input', button: 'home-search-button' },
  page: { form: 'search-form', input: 'search-input', button: 'search-button' },
  header: { form: 'header-search', input: 'header-search-input', button: 'header-search-button' },
};

/**
 * The one search form: a native GET form that works without JavaScript, in three
 * presentations. A placeholder only when one is passed (the header). Display strings only.
 */
export function SearchForm({
  variant,
  action,
  formLabel,
  fieldLabel,
  button,
  hint,
  value,
  car = null,
  placeholder = null,
}: SearchFormProps) {
  // Per variant: the header form and a page form can share one document.
  const inputId = `search-${variant}-q`;
  const hintId = `search-${variant}-hint`;
  const ids = TEST_IDS[variant];
  const showsLabel = variant !== 'header';
  // The page and hero forms own the term's one editing place; a header form can hide.
  const ownsPage = variant !== 'header';

  return (
    <form
      role="search"
      method="get"
      action={action}
      aria-label={formLabel}
      className={`${styles.form} ${styles[variant]}`}
      data-testid={ids.form}
      data-search-page={ownsPage ? '' : undefined}
    >
      {showsLabel ? (
        <label htmlFor={inputId} className={styles.label}>
          {fieldLabel}
        </label>
      ) : null}
      {car === null ? null : <input type="hidden" name="coche" value={car} />}
      <div className={styles.row}>
        <input
          id={inputId}
          type="search"
          name="q"
          maxLength={100}
          autoComplete="off"
          placeholder={placeholder === null || placeholder === '' ? undefined : placeholder}
          enterKeyHint="search"
          defaultValue={variant === 'page' ? (value ?? undefined) : undefined}
          aria-label={showsLabel ? undefined : fieldLabel}
          aria-describedby={hint === null ? undefined : hintId}
          className={styles.input}
          data-testid={ids.input}
        />
        <button type="submit" className={styles.button} data-testid={ids.button}>
          {button}
        </button>
      </div>
      {hint === null ? null : (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </form>
  );
}
