import styles from './CategorySort.module.css';

export type CategorySortOption = {
  /** The value submitted, already the public URL value. */
  value: string;
  /** Already translated, for example "Precio: de menor a mayor". */
  label: string;
};

export type CategorySortProps = {
  /** Form target, the category path without a query. The form is a GET, so the browser builds the query. */
  action: string;
  /** Visible label of the select, for example "Ordenar por". */
  label: string;
  /** Text of the submit button, for example "Ordenar". A select cannot submit without script. */
  submitLabel: string;
  /** Name of the select, which is the query parameter that carries the sort. */
  name: string;
  options: CategorySortOption[];
  /** The `value` of the option shown as chosen. */
  selected: string;
  /** A field kept across the submit, for example the selected brand. Null adds none. */
  hidden: { name: string; value: string } | null;
};

const SELECT_ID = 'category-sort';

/**
 * The sort control: a GET form with a labelled native select and a submit
 * button, so it works with no script. Page is never submitted, so a change of
 * sort lands on page 1. Display strings only.
 */
export function CategorySort({
  action,
  label,
  submitLabel,
  name,
  options,
  selected,
  hidden,
}: CategorySortProps) {
  return (
    <form action={action} method="get" className={styles.form} data-testid="category-sort">
      <label htmlFor={SELECT_ID} className={styles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <select
          id={SELECT_ID}
          name={name}
          defaultValue={selected}
          className={styles.select}
          data-testid="category-sort-select"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {hidden !== null ? <input type="hidden" name={hidden.name} value={hidden.value} /> : null}
        <button type="submit" className={styles.button} data-testid="category-sort-submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
