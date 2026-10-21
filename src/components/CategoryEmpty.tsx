import Link from 'next/link';

import styles from './CategoryEmpty.module.css';

export type CategoryEmptyProps = {
  heading: string;
  body: string;
  /** Link text, already translated: NotFound.backHome. The link goes to the home page. */
  homeLabel: string;
};

/** The state of a category with no public products. Display strings only. */
export function CategoryEmpty({ heading, body, homeLabel }: CategoryEmptyProps) {
  return (
    <section data-testid="category-empty">
      <h2 className={styles.heading}>{heading}</h2>
      <p className={styles.text}>{body}</p>
      <p className={styles.text}>
        <Link href="/" className={styles.home}>
          {homeLabel}
        </Link>
      </p>
    </section>
  );
}
