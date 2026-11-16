import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CarNotice } from '@/components/CarNotice';
import { CategoryEmpty } from '@/components/CategoryEmpty';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { DemoNotice } from '@/components/DemoNotice';
import { fitMarkKind } from '@/components/FitMark';
import { ListingGroup, groupRuns, type ListingGroupKind } from '@/components/ListingGroup';
import { ListingNote } from '@/components/ListingNote';
import { Pagination, type PaginationLink } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { SearchForm } from '@/components/SearchForm';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import { getCarContext, selectedSlug } from '@/server/car/context';
import { carLinks } from '@/server/car/return-path';
import { selectedVehicleId } from '@/server/car/state';
import { parsePageParam } from '@/server/catalogue/page-param';
import { productPath, SEARCH_PATH, searchPath, withCar } from '@/server/catalogue/paths';
import { getPublicSearchPage } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';
import { pageSeo } from '@/server/catalogue/seo';
import { formatEuroCents } from '@/server/money';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// Counts can reach four digits; es-ES drops the separator there unless asked.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

// Between the parts of the counts line, and before the page indicator: a middle dot with a space each side.
const COUNTS_SEPARATOR = ' · ';

// One database read per request, shared by generateMetadata and the page.
// Positional primitives, so the two calls share one cache entry.
const load = cache(getPublicSearchPage);

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[]; pagina?: string | string[] }>;
};

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q, pagina } = await searchParams;
  const car = await getCarContext();
  const result = await load(parseSearchTerm(q), parsePageParam(pagina), selectedVehicleId(car));
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
  const car = await getCarContext();
  const result = await load(parseSearchTerm(q), parsePageParam(pagina), selectedVehicleId(car));
  if (result === null) notFound();

  const [t, tFit, tProduct, tCategory, tDemo, tCar] = await Promise.all([
    getTranslations('Search'),
    getTranslations('Fit'),
    getTranslations('Product'),
    getTranslations('Category'),
    getTranslations('DemoNotice'),
    getTranslations('Car'),
  ]);
  // First child of every `main` below, ahead of the demo notice.
  const carNotice = car.state === 'unrecognised' ? <CarNotice text={tCar('unknownNotice')} /> : null;
  // What every internal link carries: the selected car, else nothing (D11).
  const slug = selectedSlug(car);

  const form = (
    <SearchForm
      variant="page"
      action={SEARCH_PATH}
      formLabel={t('formLabel')}
      fieldLabel={t('fieldLabel')}
      button={t('button')}
      hint={t('hint')}
      value={result.term}
      car={slug}
    />
  );
  const browse = { href: withCar('/', slug), label: t('browseAction') };

  // The counts line with a car: the term, then fits, no data and hidden (and, when there are
  // any, the exact matches) joined by a middle dot, then the page indicator when there are several pages.
  const carCountsLine = (
    term: string,
    parts: { fits: number; unknown: number; leftOut: number; exact: number },
    pageIndicator: string | null,
  ) =>
    `${t('summaryCarPrefix', { term })} ${[
      tFit('countFits', { count: parts.fits }),
      tFit('countUnknown', { count: countFormat.format(parts.unknown) }),
      tFit('countLeftOut', { count: parts.leftOut }),
      ...(parts.exact > 0 ? [tFit('countExact', { count: parts.exact })] : []),
      ...(pageIndicator === null ? [] : [pageIndicator]),
    ].join(COUNTS_SEPARATOR)}`;

  if (result.state === 'all-left-out') {
    // The loader returns this state only with a car (page 1 only); anything else is a fault, never a mislabelled card.
    if (car.state !== 'selected') throw new Error('search: all-left-out without a selected car');
    // Nothing is listed, so every other part of the line is zero by the contract.
    const line = carCountsLine(
      result.term,
      { fits: 0, unknown: 0, leftOut: result.leftOutCount, exact: 0 },
      null,
    );
    const links = carLinks(car);
    return (
      <main className="page">
        {carNotice}
        <div className={styles.header}>
          <h1 className={styles.title}>{t('heading')}</h1>
          <p className={styles.note}>{tProduct('vatIncluded')}</p>
        </div>
        <section className={styles.panel} data-testid="search-panel">
          {form}
          <p className={styles.count} data-testid="search-summary">
            {line}
          </p>
        </section>
        <CategoryEmpty
          heading={t('allOutHeading', { car: car.vehicle.name })}
          body={t('allOutBody', { count: result.leftOutCount, term: result.term })}
          action={{
            href: links.change ?? links.select,
            label: tFit('changeCar'),
            testId: 'fit-change-car',
          }}
        />
      </main>
    );
  }

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
  const pageHref = (page: number) => withCar(searchPath({ term: result.term, page }), slug);
  const previous: PaginationLink | null =
    result.page > 1
      ? { href: pageHref(result.page - 1), label: tCategory('previousPage') }
      : null;
  const next: PaginationLink | null =
    result.page < result.pageCount
      ? { href: pageHref(result.page + 1), label: tCategory('nextPage') }
      : null;

  // The fit view: only with a selected car, whose listing the loader filtered. Without one the page is as it was.
  const carFit =
    car.state === 'selected' && result.fit !== null
      ? { name: car.vehicle.name, counts: result.fit }
      : null;

  const countsLine =
    carFit === null
      ? result.pageCount > 1
        ? t('summaryPaged', counts)
        : t('summary', counts)
      : carCountsLine(
          result.term,
          {
            fits: carFit.counts.fitsCount,
            unknown: carFit.counts.unknownCount,
            leftOut: carFit.counts.leftOutCount,
            exact: carFit.counts.exactNoFitCount,
          },
          result.pageCount > 1 ? tCategory('pageIndicator', counts) : null,
        );

  // The card of one product. A card with a fit group sits in a listing group: h3 title, and the mark its group gives.
  const toCard = (product: (typeof result.products)[number]) => {
    const kind = fitMarkKind(product.fitGroup);
    return {
      key: product.slug,
      href: withCar(productPath(product.slug), slug),
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
      fit:
        kind === null
          ? null
          : { kind, label: kind === 'fits' ? tFit('markFits') : tFit('markNoFit') },
      headingLevel: product.fitGroup === null ? (2 as const) : (3 as const),
    };
  };

  const groupCopy = (group: ListingGroupKind, name: string, exactCount: number) => {
    switch (group) {
      case 'fits':
        return { heading: tFit('fitsHeading', { car: name }), help: null };
      case 'unknown':
        return { heading: tFit('unknownHeading'), help: tFit('unknownHelp') };
      case 'no-fit-exact':
        // The count is the group's total across all pages, not the cards of this page.
        return {
          heading: tFit('exactHeading'),
          help: tFit('exactHelp', { car: name, count: exactCount }),
        };
    }
  };

  let listing;
  if (carFit !== null) {
    const runs = groupRuns(result.products, (product) => {
      // The loader gives every card of a car listing a group; a card without one is a fault, never shown as a group.
      if (product.fitGroup === null) throw new Error('search: card without a fit group');
      return product.fitGroup;
    });
    listing = (
      <>
        {carFit.counts.fitsCount === 0 ? (
          <ListingNote text={tFit('noFitsNote', { car: carFit.name })} />
        ) : null}
        {runs.map((run) => (
          <ListingGroup
            key={run.group}
            group={run.group}
            {...groupCopy(run.group, carFit.name, carFit.counts.exactNoFitCount)}
          >
            <ProductGrid cards={run.items.map(toCard)} />
          </ListingGroup>
        ))}
      </>
    );
  } else {
    listing = <ProductGrid cards={result.products.map(toCard)} />;
  }

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
          {countsLine}
        </p>
      </section>
      {listing}
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
