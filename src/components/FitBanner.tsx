import type { ProductFitBanner } from '@/server/catalogue/product-fit';

import styles from './FitBanner.module.css';

const KIND_CLASS: Record<ProductFitBanner, string> = {
  fits: styles.fits,
  'no-fit': styles.noFit,
  unknown: styles.unknown,
  unchecked: styles.unchecked,
};

/**
 * What the server says about the product and the selected car (S5.9). The page
 * decides when to render it (only with a selected car) and passes finished
 * strings: `help` only for `unknown`, `link` only for `no-fit`. The meaning is in
 * the words; the tint, the rule and the glyph repeat it. No script, no state.
 */
export function FitBanner({
  kind,
  text,
  help,
  link,
}: {
  kind: ProductFitBanner;
  text: string;
  help: string | null;
  link: { href: string; label: string } | null;
}) {
  const showGlyph = kind !== 'unchecked';
  return (
    <div
      role="note"
      className={`${styles.banner} ${KIND_CLASS[kind]}`}
      data-testid="fit-banner"
      data-fit={kind}
    >
      <div className={styles.lead}>
        {showGlyph && <span className={styles.glyph} aria-hidden="true" />}
        <div className={styles.text}>
          <span className={styles.label}>{text}</span>
          {help !== null && <p className={styles.help}>{help}</p>}
        </div>
      </div>
      {link !== null && (
        <a className={styles.link} href={link.href} data-testid="fit-banner-link">
          {link.label}
        </a>
      )}
    </div>
  );
}
