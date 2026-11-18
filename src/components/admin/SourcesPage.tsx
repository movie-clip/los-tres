import { AdminNotice } from './AdminNotice';
import styles from './SourcesPage.module.css';

export type SourcesPageProps = {
  heading: string;
  /** The fixed-text result of the last save, or null. Never a name or an address. */
  notice: string | null;
  intro: string;
  /** "2 tiendas y 3 feeds". */
  summary: string;
  children: React.ReactNode;
};

/** The page column of "Tiendas y feeds": title, the notice after a save, the rule in one sentence, the summary, then the lists. */
export function SourcesPage({ heading, notice, intro, summary, children }: SourcesPageProps) {
  return (
    <main className="page">
      <h1 className={styles.heading}>{heading}</h1>
      {notice ? (
        <div className={styles.notice}>
          <AdminNotice text={notice} />
        </div>
      ) : null}
      <p className={styles.intro}>{intro}</p>
      <p className={styles.summary} data-testid="sources-summary">
        {summary}
      </p>
      {children}
    </main>
  );
}
