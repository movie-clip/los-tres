import { EmptyList } from './EmptyList';
import { LinkButton } from './LinkButton';
import { Pagination, type PaginationProps } from '../Pagination';
import { ProductSearchForm, type ProductSearchFormProps } from './ProductSearchForm';
import { TextLink } from './TextLink';
import styles from './ProductsPage.module.css';

export type ProductsPageProps = {
  heading: string;
  intro: string;
  search: ProductSearchFormProps;
  /** "34 productos ocultos para «filtro»" and, while a term or the filter is on, the way back to the bare list. Null with no products at all. */
  summary: { text: string; clear: { href: string; label: string } | null } | null;
  /** Accessible name of the product list. */
  listLabel: string;
  /** Shown instead of the list: one sentence and one way out, or none. */
  empty: { text: string; action: { href: string; label: string } | null } | null;
  /** More than one page: the pager, whose links keep the term and the filter. */
  pager: PaginationProps | null;
  /** The product rows, as list items. */
  children: React.ReactNode;
};

/** The page column of "Productos": title, intro, search, summary, then the rows or the one empty state, then the pager. */
export function ProductsPage({ heading, intro, search, summary, listLabel, empty, pager, children }: ProductsPageProps) {
  return (
    <main className="page">
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.intro}>{intro}</p>
      <ProductSearchForm {...search} />
      {summary ? (
        <p className={styles.summary} data-testid="products-summary">
          <span>{summary.text}</span>
          {summary.clear ? (
            <>
              <span aria-hidden="true">·</span>
              <TextLink href={summary.clear.href} label={summary.clear.label} testId="products-clear" />
            </>
          ) : null}
        </p>
      ) : null}
      {empty ? (
        <>
          <EmptyList text={empty.text} testId="products-empty" />
          {empty.action ? (
            <div className={styles.emptyLink}>
              <LinkButton href={empty.action.href} label={empty.action.label} testId="products-empty-link" />
            </div>
          ) : null}
        </>
      ) : (
        <ul className={styles.list} aria-label={listLabel} data-testid="products-list">
          {children}
        </ul>
      )}
      {pager ? <Pagination {...pager} /> : null}
    </main>
  );
}
