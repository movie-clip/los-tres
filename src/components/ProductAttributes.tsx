import styles from './ProductAttributes.module.css';

/** At most this many approvals are drawn; the rest sit behind the native control (06-ux § States). */
export const APPROVALS_VISIBLE = 8;

/**
 * One line of the card, finished by the page. `value` is a single short value
 * (viscosity, volume, oil type) that never breaks; `tokens` is the ACEA line, one
 * unbreakable span per token, joined by ", "; `list` is the approvals.
 */
export type ProductAttributeRow =
  | { key: string; kind: 'value'; label: string; value: string }
  | { key: string; kind: 'tokens'; label: string; tokens: readonly string[] }
  | {
      key: string;
      kind: 'list';
      label: string;
      items: readonly string[];
      /** Product.approvalsMore with the count behind it; null when nothing collapses. */
      moreLabel: string | null;
      /** Product.approvalsFewer, the open control label. */
      fewerLabel: string;
    };

export type ProductAttributesProps = {
  /** Product.attributesHeading. */
  heading: string;
  /** Only the attributes the product holds, in display order, never empty: the page draws no card for none. */
  rows: readonly ProductAttributeRow[];
};

function Items({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.items}>
      {items.map((item, index) => (
        <li key={index} className={styles.item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Value({ row }: { row: ProductAttributeRow }) {
  if (row.kind === 'value') {
    return <dd className={`${styles.value} ${styles.nowrap}`}>{row.value}</dd>;
  }
  if (row.kind === 'tokens') {
    const last = row.tokens.length - 1;
    return (
      <dd className={styles.value}>
        {row.tokens.map((token, index) => (
          <span key={index}>
            <span className={styles.nowrap}>
              {token}
              {index < last ? ',' : ''}
            </span>
            {index < last ? ' ' : ''}
          </span>
        ))}
      </dd>
    );
  }
  const collapses = row.moreLabel !== null && row.items.length > APPROVALS_VISIBLE;
  const shown = collapses ? row.items.slice(0, APPROVALS_VISIBLE) : row.items;
  const rest = collapses ? row.items.slice(APPROVALS_VISIBLE) : [];
  return (
    <dd className={`${styles.value} ${styles.listValue}`}>
      <Items items={shown} />
      {collapses ? (
        <details className={styles.more} data-testid="product-attributes-more">
          <summary className={styles.summary} data-testid="product-attributes-toggle">
            <span className={styles.moreLabel}>{row.moreLabel}</span>
            <span className={styles.fewerLabel}>{row.fewerLabel}</span>
            <span className={styles.chevron} aria-hidden="true" />
          </summary>
          <div className={styles.rest}>
            <Items items={rest} />
          </div>
        </details>
      ) : null}
    </dd>
  );
}

/**
 * The engine-oil attributes in their own card under the offers (S15.3, 06-ux
 * § Screens). Display strings only: the page decides which rows exist and builds
 * every label. Every value is a React text node, never markup. The approvals
 * control composes the Vehicle list control, a native `details` that works without
 * script and is in the first HTML.
 */
export function ProductAttributes({ heading, rows }: ProductAttributesProps) {
  return (
    <section className={styles.card} data-testid="product-attributes">
      <h2 className={styles.heading}>{heading}</h2>
      <dl className={styles.list}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={row.kind === 'list' ? `${styles.row} ${styles.stacks}` : styles.row}
            data-testid="product-attribute"
          >
            <dt className={styles.term}>{row.label}</dt>
            <Value row={row} />
          </div>
        ))}
      </dl>
    </section>
  );
}
