import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ProductRow } from '@/components/admin/ProductRow';
import { ProductsPage } from '@/components/admin/ProductsPage';
import { getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import {
  adminProductHref,
  adminProductListHref,
  parseAdminProductListQuery,
  type AdminProductListQuery,
} from '@/server/admin/product-rules';
import { listProductsForAdmin, type AdminProductList, type AdminProductRow } from '@/server/admin/products';
import { requireAdminPage } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Next resolves metadata before the page body, so this is a server entry point of
  // an admin route: the role check comes first (guardrail 3). Cached per request.
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('productsTitle', { siteName: getSiteName() }) };
}

type Translate = Awaited<ReturnType<typeof getTranslations<'Admin.Products'>>>;

const SOURCES_PATH = '/admin/tiendas';

// CLDR drops the separator on four digits; the design wants 1.234 productos.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

/** The count line: the count, the cleaned term and the filter, as the list was asked. */
function summaryText(list: AdminProductList, t: Translate): string {
  const values = { count: list.total, countText: countFormat.format(list.total), term: list.term };
  if (list.hiddenOnly) return list.term !== '' ? t('summaryHiddenTerm', values) : t('summaryHidden', values);
  return list.term !== '' ? t('summaryTerm', values) : t('summary', values);
}

/**
 * The one sentence of an empty list and its way out, or null when rows are drawn. A total of zero is
 * always one of the three empty states, whatever the page; a page past the last needs rows to exist.
 */
function emptyState(list: AdminProductList, query: AdminProductListQuery, t: Translate) {
  const clear = { href: adminProductListHref({ term: '', hiddenOnly: false, page: 1 }), label: t('clearAll') };
  if (list.empty === 'no_products') {
    return { text: t('emptyNoProducts'), action: { href: SOURCES_PATH, label: t('emptyNoProductsLink') } };
  }
  if (list.empty === 'no_hidden') return { text: t('emptyNoHidden'), action: clear };
  if (list.empty === 'no_match') {
    const text = list.hiddenOnly
      ? t('emptyNoMatchHidden', { term: list.term })
      : t('emptyNoMatch', { term: list.term });
    return { text, action: clear };
  }
  if (list.pastLast) {
    return {
      text: t('emptyPastLast', { pages: list.pageCount }),
      action: { href: adminProductListHref({ ...query, page: 1 }), label: t('pastLastLink') },
    };
  }
  return null;
}

function row(product: AdminProductRow, query: AdminProductListQuery, t: Translate) {
  const identifiers = [
    product.brand !== null ? { label: t('brandLabel'), value: product.brand, testId: 'product-row-brand' } : null,
    product.partNumber !== null
      ? { label: t('partNumberLabel'), value: product.partNumber, testId: 'product-row-part-number' }
      : null,
    product.ean !== null ? { label: t('eanLabel'), value: product.ean, testId: 'product-row-ean' } : null,
    { label: t('slugLabel'), value: product.slug, testId: 'product-row-slug' },
  ].filter((item): item is NonNullable<typeof item> => item !== null);
  return (
    <ProductRow
      key={product.id}
      // The product page carries the list's own query, so its way back rebuilds this list (AC 31).
      href={adminProductHref(product.id, query)}
      title={product.title}
      state={{
        hidden: product.hidden,
        tagHidden: t('tagHidden'),
        tagNotHidden: t('tagNotHidden'),
        publicNow: product.publicNow,
        publicLabel: t('publicNowLabel'),
        publicYes: t('publicNowYes'),
        publicNo: t('publicNowNo'),
      }}
      identifiers={identifiers}
    />
  );
}

type SearchParams = Promise<{
  q?: string | string[];
  ocultos?: string | string[];
  pagina?: string | string[];
}>;

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  // The role check of this page (guardrail 3); the layout also checks, once per request.
  await requireAdminPage();
  const query = parseAdminProductListQuery(await searchParams);
  const [t, list] = await Promise.all([getTranslations('Admin.Products'), listProductsForAdmin(query)]);

  const empty = emptyState(list, query, t);
  // With a term or the filter on, a way back to the bare list sits in the count line, unless the
  // empty state already carries it as its button. With no products at all there is nothing to count.
  const filtered = list.term !== '' || list.hiddenOnly;
  const emptyHasClear = list.empty === 'no_hidden' || list.empty === 'no_match';
  const summary =
    list.empty === 'no_products'
      ? null
      : {
          text: summaryText(list, t),
          clear:
            filtered && !emptyHasClear
              ? { href: adminProductListHref({ term: '', hiddenOnly: false, page: 1 }), label: t('clearAll') }
              : null,
        };
  // The pager keeps the term and the filter; it exists only with more than one page and never on a past-last page.
  const pager =
    list.pageCount > 1 && !list.pastLast
      ? {
          navLabel: t('paginationLabel'),
          indicator: t('pageIndicator', { page: list.page, pages: list.pageCount }),
          previous:
            list.page > 1
              ? { href: adminProductListHref({ ...query, page: list.page - 1 }), label: t('previousPage') }
              : null,
          next:
            list.page < list.pageCount
              ? { href: adminProductListHref({ ...query, page: list.page + 1 }), label: t('nextPage') }
              : null,
        }
      : null;

  return (
    <ProductsPage
      heading={t('heading')}
      intro={t('intro')}
      search={{
        action: adminProductListHref({ term: '', hiddenOnly: false, page: 1 }),
        formLabel: t('searchFormLabel'),
        label: t('searchLabel'),
        hint: t('searchHint'),
        term: list.term,
        hiddenOnly: list.hiddenOnly,
        hiddenOnlyLabel: t('hiddenOnlyLabel'),
        buttonLabel: t('searchButton'),
      }}
      summary={summary}
      listLabel={t('listLabel')}
      empty={empty}
      pager={pager}
    >
      {list.rows.map((product) => row(product, query, t))}
    </ProductsPage>
  );
}
