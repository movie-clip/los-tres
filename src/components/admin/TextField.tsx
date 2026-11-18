import type { Ref } from 'react';

import { FieldHint } from './FieldHint';
import styles from './TextField.module.css';

export type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  type: 'email' | 'password' | 'text' | 'url';
  autoComplete: string;
  inputMode?: 'email';
  /** The value to start from; an uncontrolled field, so a form reset restores it. */
  defaultValue?: string;
  /** Keeps the value and the focus order while a submit is in flight. */
  readOnly?: boolean;
  /** The field message, already translated. Its presence marks the field invalid. */
  error?: string;
  /** A hint under the field, already translated. Joined to the field with aria-describedby. */
  hint?: string;
  /** Ids of other elements that describe this field, such as a warning block above it. */
  describedBy?: string;
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
  hint,
  describedBy,
  inputRef,
}: TextFieldProps) {
  const messageId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [describedBy, error ? messageId : null, hint ? hintId : null].filter(Boolean).join(' ');
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
        aria-describedby={described || undefined}
        className={error ? `${styles.input} ${styles.invalid}` : styles.input}
        spellCheck={false}
        autoCapitalize="none"
      />
      {error ? (
        <span id={messageId} className={styles.message}>
          {error}
        </span>
      ) : null}
      {hint ? <FieldHint id={hintId} text={hint} /> : null}
    </div>
  );
}
