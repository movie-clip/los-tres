import styles from './ValueLine.module.css';

export type ValueLineProps = {
  /** "Identificador:", "Dominio:" or "Tienda:", colon included, already translated. */
  label: string;
  /** What the admin cannot change here: a slug, a shop name, or the host of a feed address. Never the stored address. */
  value: string;
  testId?: string;
};

/**
 * One line that shows a value and is not a control: a muted label, then the
 * value in bold. Spans, not a paragraph, so `.page p` does not grey the value.
 */
export function ValueLine({ label, value, testId }: ValueLineProps) {
  return (
    <div className={styles.line} data-testid={testId}>
      <span className={styles.label}>{label}</span> <span className={styles.value}>{value}</span>
    </div>
  );
}
