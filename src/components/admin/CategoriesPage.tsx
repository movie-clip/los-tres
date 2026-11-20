import { EmptyList } from './EmptyList';
import { LinkButton } from './LinkButton';
import styles from './CategoriesPage.module.css';

export type CategoriesPageProps = {
  heading: string;
  /** The intro and the two rule sentences, in order. Always on the page, with or without script. */
  rules: string[];
  /** "2 feeds · 3 categorías sin revisar", or null when there is no feed. */
  summary: string | null;
  /** Accessible name of the feed list. */
  listLabel: string;
  /** Shown instead of the list when no feed exists: one sentence and one way out. */
  empty: { text: string; link: { href: string; label: string } } | null;
  /** The feed sections, as list items. */
  children: React.ReactNode;
};

/** The page column of "Categorías de los feeds": title, the rules in three sentences, the summary, then one section per feed. */
export function CategoriesPage({ heading, rules, summary, listLabel, empty, children }: CategoriesPageProps) {
  return (
    <main className="page">
      <h1 className={styles.heading}>{heading}</h1>
      <div className={styles.rules} data-testid="categories-rules">
        {rules.map((rule) => (
          <p key={rule} className={styles.rule}>
            {rule}
          </p>
        ))}
      </div>
      {summary ? (
        <p className={styles.summary} data-testid="categories-summary">
          {summary}
        </p>
      ) : null}
      {empty ? (
        <>
          <EmptyList text={empty.text} testId="categories-empty" />
          <div className={styles.emptyLink}>
            <LinkButton href={empty.link.href} label={empty.link.label} testId="categories-empty-link" />
          </div>
        </>
      ) : (
        <ul className={styles.list} aria-label={listLabel} data-testid="categories-list">
          {children}
        </ul>
      )}
    </main>
  );
}
