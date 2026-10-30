import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CarNotice } from '@/components/CarNotice';
import { CategoryEmpty } from '@/components/CategoryEmpty';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { DemoNotice } from '@/components/DemoNotice';
import { Pagination, type PaginationLink } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { SearchForm } from '@/components/SearchForm';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { getCarContext } from '@/server/car/context';
import { parsePageParam } from '@/server/catalogue/page-param';
import { productPath, SEARCH_PATH, searchPath } from '@/server/catalogue/paths';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { pageSeo } from '@/server/catalogue/seo';
import { formatEuroCents } from '@/server/money';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// One database read per request, shared by generateMetadata and the page.
// Positional primitives, so the two calls share one cache entry.
const load = cache(getPublicSearchPage);

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[]; pagina?: string | string[] }>;
};

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q, pagina } = await searchParams;
  const result = await load(parseSearchTerm(q), parsePageParam(pagina));
  if (result === null) return {};
  const t = await getTranslations('Search');
  const siteName = getSiteName();
  const title =
    result.state === 'empty-query'
      ? t('metaTitle', { siteName })
      : result.state === 'results' && result.page > 1
        ? t('metaTitleTermPaged', { term: result.term, page: result.page, siteName })
        : t('metaTitleTerm', { term: result.term, siteName });
  // Every state is noindex with no canonical, whatever the query (D-1).
  return { title, ...pageSeo(getPublicOrigin(), SEARCH_PATH, false) };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, pagina } = await searchParams;
  const result = await load(parseSearchTerm(q), parsePageParam(pagina));
  if (result === null) notFound();

  const [t, tProduct, tCategory, tDemo, tCar, car] = await Promise.all([
    getTranslations('Search'),
    getTranslations('Product'),
    getTranslations('Category'),
    getTranslations('DemoNotice'),
    getTranslations('Car'),
    getCarContext(),
  ]);
  // First child of every `main` below, ahead of the demo notice.
  const carNotice = car.state === 'unrecognised' ? <CarNotice text={tCar('unknownNotice')} /> : null;

  const form = (
    <SearchForm
      variant="page"
      action={SEARCH_PATH}
      formLabel={t('formLabel')}
      fieldLabel={t('fieldLabel')}
      button={t('button')}
      hint={t('hint')}
      value={result.term}
    />
  );
  const browse = { href: '/', label: t('browseAction') };

  if (result.state !== 'results') {
    return (
      <main className="page">
        {carNotice}
        <div className={styles.header}>
          <h1 className={styles.title}>{t('heading')}</h1>
        </div>
        <section className={styles.panel} data-testid="search-panel">
          {form}
        </section>
        {result.state === 'empty-query' ? (
          <CategoryEmpty heading={t('promptHeading')} body={t('promptBody')} action={browse} />
        ) : (
          <CategoryEmpty
            heading={t('noResultsHeading')}
            body={t('noResultsBody', { term: result.term })}
            action={browse}
          />
        )}
      </main>
    );
  }

  const counts = {
    count: result.productCount,
    term: result.term,
    page: result.page,
    pages: result.pageCount,
  };
  const pageHref = (page: number) => searchPath({ term: result.term, page });
  const previous: PaginationLink | null =
    result.page > 1
      ? { href: pageHref(result.page - 1), label: tCategory('previousPage') }
      : null;
  const next: PaginationLink | null =
    result.page < result.pageCount
      ? { href: pageHref(result.page + 1), label: tCategory('nextPage') }
      : null;

  return (
    <main className="page">
      {carNotice}
      {result.demoOnly && <DemoNotice text={tDemo('body')} />}
      <div className={styles.header}>
        <h1 className={styles.title}>{t('heading')}</h1>
        <p className={styles.note}>{tProduct('vatIncluded')}</p>
      </div>
      <section className={styles.panel} data-testid="search-panel">
        {form}
        <p className={styles.count} data-testid="search-summary">
          {result.pageCount > 1 ? t('summaryPaged', counts) : t('summary', counts)}
        </p>
      </section>
      <ProductGrid
        cards={result.products.map((product) => ({
          key: product.slug,
          href: productPath(product.slug),
          title: product.title,
          brand: product.brand,
          spec:
            product.partNumber === null
              ? null
              : tCategory('specRef', { partNumber: product.partNumber }),
          // "Desde" only when the price is the lowest of several shops.
          priceFrom: product.offerCount >= 2 ? tCategory('priceFrom') : null,
          price: formatEuroCents(product.lowestPriceCents),
          shopCount: tProduct('shopCount', { count: product.offerCount }),
          illustration: toIllustrationKey(product.categorySlug),
        }))}
      />
      {result.pageCount > 1 ? (
        <Pagination
          navLabel={tCategory('paginationLabel')}
          indicator={tCategory('pageIndicator', counts)}
          previous={previous}
          next={next}
        />
      ) : null}
    </main>
  );
}
