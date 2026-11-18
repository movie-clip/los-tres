import type { ReactNode } from 'react';

import { LinkButton } from './LinkButton';
import styles from './NetworksSection.module.css';

export type NetworksSectionProps = {
  heading: string;
  /** "2 redes", "Sin redes". */
  count: string;
  add: { href: string; label: string };
  /** The network list or the empty block. */
  children: ReactNode;
};

/** The "Redes" part of the page: heading, count and the create link on one wrapping line, then the list. */
export function NetworksSection({ heading, count, add, children }: NetworksSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="networks-heading" data-testid="networks-section">
      <div className={styles.head}>
        <h2 id="networks-heading" className={styles.heading}>
          {heading}
        </h2>
        <span className={styles.count} data-testid="networks-count">
          {count}
        </span>
        <LinkButton href={add.href} label={add.label} testId="add-network" />
      </div>
      {children}
    </section>
  );
}
