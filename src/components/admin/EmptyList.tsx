import styles from './EmptyList.module.css';

export type EmptyListProps = {
  /** One sentence that says what is missing and what to do first. */
  text: string;
  testId?: string;
};

/** The shop box look holding one muted sentence, where a list has no rows yet. */
export function EmptyList({ text, testId }: EmptyListProps) {
  return (
    <div className={styles.box} data-testid={testId}>
      <p className={styles.text}>{text}</p>
    </div>
  );
}
