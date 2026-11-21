import { FieldHint } from './FieldHint';
import { TextField } from './TextField';
import styles from './ProductSearchForm.module.css';

export type ProductSearchFormProps = {
  /** Where the form goes: the list's own path. A GET form, so the state lives in the address. */
  action: string;
  /** Accessible name of the search landmark. */
  formLabel: string;
  label: string;
  hint: string;
  /** The cleaned, cut term the search actually used, so a cut shows; empty for none. */
  term: string;
  hiddenOnly: boolean;
  hiddenOnlyLabel: string;
  buttonLabel: string;
};

const FIELD_ID = 'products-q';
const HINT_ID = `${FIELD_ID}-hint`;

/**
 * The product search: one GET form, so it works without script. The label is
 * always visible and there is no placeholder; the hint is joined to the field
 * with aria-describedby. The checkbox sends `ocultos=1` only when ticked.
 */
export function ProductSearchForm({
  action,
  formLabel,
  label,
  hint,
  term,
  hiddenOnly,
  hiddenOnlyLabel,
  buttonLabel,
}: ProductSearchFormProps) {
  return (
    <form role="search" aria-label={formLabel} method="get" action={action} className={styles.form} data-testid="products-search">
      <div className={styles.row}>
        <div className={styles.field}>
          <TextField id={FIELD_ID} name="q" label={label} type="text" autoComplete="off" defaultValue={term} describedBy={HINT_ID} />
        </div>
        <button type="submit" className={styles.submit} data-testid="products-search-submit">
          {buttonLabel}
        </button>
      </div>
      <FieldHint id={HINT_ID} text={hint} testId="products-search-hint" />
      <label className={styles.check}>
        <input type="checkbox" name="ocultos" value="1" defaultChecked={hiddenOnly} className={styles.box} data-testid="products-hidden-only" />
        <span>{hiddenOnlyLabel}</span>
      </label>
    </form>
  );
}
