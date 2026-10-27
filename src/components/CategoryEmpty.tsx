import Link from 'next/link';

import styles from './CategoryEmpty.module.css';

export type CategoryEmptyProps = {
  heading: string;
  body: string;
  /**
   * Link text, already translated: NotFound.backHome. The link goes to the home page.
   * Omitted on the home page itself, where the link paragraph is not rendered.
   */
  homeLabel?: string;
};

/** The state of a category with no public products. Display strings only. */
export function CategoryEmpty({ heading, body, homeLabel }: CategoryEmptyProps) {
  return (
    <section className={styles.empty} data-testid="category-empty">
      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.text}>{body}</p>
      {homeLabel === undefined ? null : (
        <p className={styles.text}>
          <Link href="/" className={styles.home}>
            {homeLabel}
          </Link>
        </p>
      )}
    </section>
  );
}
