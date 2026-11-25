import { StatusTag } from './StatusTag';
import { ValueLine } from './ValueLine';
import styles from './ProductState.module.css';

export type ProductStateProps = {
  /** The admin's hide, as the server stored it. */
  hidden: boolean;
  /** "Oculto" and "No oculto", or the feminine pair for an offer; already translated. */
  tagHidden: string;
  tagNotHidden: string;
  /** The public page shows it now, as the server's visibility scope answered. */
  publicNow: boolean;
  /** "En el sitio ahora:" with its colon, "Sí" and "No". */
  publicLabel: string;
  publicYes: string;
  publicNo: string;
  /** "Motivo:" with its colon, already translated. */
  reasonLabel: string;
  /** Why the site does not show it now, as finished text; null when it is on the site, and then no line is drawn. */
  reason: string | null;
  /** `product-row`, `product` or `offer`: the test ids are `<prefix>-tag`, `<prefix>-public` and `<prefix>-reason`. */
  testIdPrefix: string;
};

/**
 * The two facts of a product or an offer on one line: the hidden flag as a tag
 * and, apart from it in a different form, whether the site shows it now. The
 * words carry the meaning, fill and outline only back them up; the two never
 * share a label. When the site does not show it, the reason follows on a line
 * of its own, as plain text in the page (US-2.5).
 */
export function ProductState({
  hidden,
  tagHidden,
  tagNotHidden,
  publicNow,
  publicLabel,
  publicYes,
  publicNo,
  reasonLabel,
  reason,
  testIdPrefix,
}: ProductStateProps) {
  return (
    <div className={styles.state}>
      {/* The tag looks are by look: filled for the flag that is on, outlined for the one that is off. */}
      <StatusTag
        variant={hidden ? 'approved' : 'notApproved'}
        label={hidden ? tagHidden : tagNotHidden}
        testId={`${testIdPrefix}-tag`}
      />
      <ValueLine label={publicLabel} value={publicNow ? publicYes : publicNo} testId={`${testIdPrefix}-public`} />
      {reason !== null ? (
        <div className={styles.reason}>
          <ValueLine label={reasonLabel} value={reason} testId={`${testIdPrefix}-reason`} />
        </div>
      ) : null}
    </div>
  );
}
