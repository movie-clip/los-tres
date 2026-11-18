import type { ReactNode } from 'react';

import styles from './InfoBlock.module.css';

export type InfoBlockProps = {
  /** Joined to the field it concerns by that field's aria-describedby. */
  id?: string;
  title: string;
  body: string;
  /** A link button, for a missing prerequisite. */
  children?: ReactNode;
  testId?: string;
};

/**
 * A bold title and one sentence in the admin notice look, static: no live role,
 * so a screen reader reads it in place and is not interrupted. The warning
 * before a field and the missing-prerequisite block are both this. No colour
 * says "warning".
 */
export function InfoBlock({ id, title, body, children, testId }: InfoBlockProps) {
  return (
    <div id={id} className={styles.block} data-testid={testId}>
      <span className={styles.title}>{title}</span>
      <span className={styles.body}>{body}</span>
      {children ? <div className={styles.action}>{children}</div> : null}
    </div>
  );
}
