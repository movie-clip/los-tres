import { FieldHint } from './FieldHint';
import styles from './SelectField.module.css';

export type SelectOption = { value: string; label: string };

export type SelectFieldProps = {
  id: string;
  name: string;
  label: string;
  options: SelectOption[];
  /** The unselected first option ("Elige una tienda"); absent on an edit, where a choice is always made. */
  prompt?: string;
  /** The option value to start from; an uncontrolled field, so a form reset restores it. '' selects the prompt. */
  defaultValue: string;
  /** While a submit is in flight the field ignores the pointer but stays in the focus order. */
  readOnly?: boolean;
  /** The field message, already translated. Its presence marks the field invalid. */
  error?: string;
  hint?: string;
};

/**
 * A labelled native select, in the look of the text field. The label is always
 * visible, a message and a hint are joined to it with aria-describedby, and
 * there is no custom arrow. A long option is clipped with an ellipsis in the
 * closed control and read in full in the open list.
 */
export function SelectField({ id, name, label, options, prompt, defaultValue, readOnly, error, hint }: SelectFieldProps) {
  const messageId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [error ? messageId : null, hint ? hintId : null].filter(Boolean).join(' ');
  const classes = [styles.select, error ? styles.invalid : '', readOnly ? styles.readOnly : ''].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? 'true' : undefined}
        aria-readonly={readOnly || undefined}
        aria-describedby={described || undefined}
        className={classes}
      >
        {prompt !== undefined ? <option value="">{prompt}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={messageId} className={styles.message}>
          {error}
        </span>
      ) : null}
      {hint ? <FieldHint id={hintId} text={hint} /> : null}
    </div>
  );
}
