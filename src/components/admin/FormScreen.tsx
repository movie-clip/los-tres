import type { ReactNode } from 'react';

import { TextLink } from './TextLink';
import styles from './FormScreen.module.css';

export type FormScreenProps = {
  /** The link above the heading. Absent on the missing-prerequisite screen, which ends in a link button. */
  back?: { href: string; label: string };
  heading: string;
  /** One muted sentence under the heading. */
  intro: string;
  children: ReactNode;
};

/**
 * A form route: the way back, the heading, one sentence, then one left-aligned
 * column of at most 24rem. Nothing sits beside the column, at any width.
 */
export function FormScreen({ back, heading, intro, children }: FormScreenProps) {
  return (
    <main className="page">
      <div className={styles.column}>
        {back ? <TextLink href={back.href} label={back.label} testId="form-back" /> : null}
        <h1 className={styles.heading}>{heading}</h1>
        <p className={styles.intro}>{intro}</p>
        <div className={styles.body}>{children}</div>
      </div>
    </main>
  );
}
