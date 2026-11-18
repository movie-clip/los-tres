import styles from './FieldHint.module.css';

export type FieldHintProps = {
  /** Joined to a field by that field's aria-describedby. */
  id?: string;
  text: string;
  testId?: string;
};

/**
 * One or two sentences under a field or a value line. A span, not a paragraph:
 * `.page p` in globals.css would grey it a second time.
 */
export function FieldHint({ id, text, testId }: FieldHintProps) {
  return (
    <span id={id} className={styles.hint} data-testid={testId}>
      {text}
    </span>
  );
}
