import styles from './SourcesPage.module.css';

export type SourcesPageProps = {
  heading: string;
  intro: string;
  /** "2 tiendas y 3 feeds". */
  summary: string;
  children: React.ReactNode;
};

/** The page column of "Tiendas y feeds": title, the rule in one sentence, the summary, then the list. */
export function SourcesPage({ heading, intro, summary, children }: SourcesPageProps) {
  return (
    <main className="page">
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.intro}>{intro}</p>
      <p className={styles.summary} data-testid="sources-summary">
        {summary}
      </p>
      {children}
    </main>
  );
}
