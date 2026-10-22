import type { Ref } from 'react';

import styles from './TextField.module.css';

export type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  type: 'email' | 'password';
  autoComplete: string;
  inputMode?: 'email';
  /** The value to start from; an uncontrolled field, so a form reset restores it. */
  defaultValue?: string;
  /** Keeps the value and the focus order while a submit is in flight. */
  readOnly?: boolean;
  /** The field message, already translated. Its presence marks the field invalid. */
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
};

/**
 * A labelled text field. The label is always visible and there is no
 * placeholder. An invalid field is told apart by a thicker dark border and a
 * message joined to it with aria-describedby, never by colour alone.
 */
export function TextField({
  id,
  name,
  label,
  type,
  autoComplete,
  inputMode,
  defaultValue,
  readOnly,
  error,
  inputRef,
}: TextFieldProps) {
  const messageId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        defaultValue={defaultValue}
        readOnly={readOnly}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? messageId : undefined}
        className={error ? `${styles.input} ${styles.invalid}` : styles.input}
        spellCheck={false}
        autoCapitalize="none"
      />
      {error ? (
        <span id={messageId} className={styles.message}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
