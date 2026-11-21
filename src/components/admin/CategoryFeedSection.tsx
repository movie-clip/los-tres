import { DemoMark } from './DemoMark';
import { ValueLine } from './ValueLine';
import styles from './CategoryFeedSection.module.css';

export type CategoryFeedSectionProps = {
  id: number;
  /** "Feed 3 de Tienda Demo Uno". */
  title: string;
  /** Draws the Demo mark beside the title. */
  demo: boolean;
  demoLabel: string;
  /** "Dominio: ofertas.example.com" or "Archivo: mi-catalogo.csv". The value is the host or the file name, never the feed address. */
  domain: { label: string; value: string };
  /** The kind line: "Red: Red uno", "Archivo de catálogo" or "Subido por la tienda"; null draws none. */
  meta: string | null;
  /** "Estado del feed: Aprobado". A state word, not a control. */
  state: { label: string; value: string };
  /** Notes under the state, in order: not approved, paused, demonstration. */
  notes: string[];
  /** A sentence in place of the rows: the feed was never imported, or brings no category. */
  statement: string | null;
  /** "2 categorías · todas revisadas", or null when the feed has no rows. */
  summary: string | null;
  /** The products with no category cell, with what that means. Never a row, never a control. */
  emptyCellNote: string | null;
  /** The rows, drawn by the client part. */
  children: React.ReactNode;
};

/**
 * One feed in an outlined box: its title and Demo mark, its identity lines, the
 * notes that say whether its products can show, the summary, then the rows.
 * Display strings only. The feed address never reaches it, only its host.
 */
export function CategoryFeedSection({
  id,
  title,
  demo,
  demoLabel,
  domain,
  meta,
  state,
  notes,
  statement,
  summary,
  emptyCellNote,
  children,
}: CategoryFeedSectionProps) {
  return (
    <li className={styles.box} data-testid={`category-feed-${id}`}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>{title}</h2>
        {demo ? <DemoMark label={demoLabel} /> : null}
      </div>
      <div className={styles.identity}>
        <ValueLine label={domain.label} value={domain.value} testId="category-feed-domain" />
        {meta ? (
          <span className={styles.meta} data-testid="category-feed-meta">
            {meta}
          </span>
        ) : null}
        <ValueLine label={state.label} value={state.value} testId="category-feed-state" />
        {notes.map((note) => (
          <span key={note} className={styles.note} data-testid="category-feed-note">
            {note}
          </span>
        ))}
      </div>
      {statement ? (
        <span className={styles.note} data-testid="category-feed-statement">
          {statement}
        </span>
      ) : null}
      {summary ? (
        <span className={styles.summary} data-testid="category-feed-summary">
          {summary}
        </span>
      ) : null}
      {emptyCellNote ? (
        <span className={styles.emptyCells} data-testid="category-feed-empty-cells">
          {emptyCellNote}
        </span>
      ) : null}
      {children}
    </li>
  );
}
