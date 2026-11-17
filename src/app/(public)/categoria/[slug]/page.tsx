import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  BrandChips,
  NARROW_BRAND_CHIPS,
  VISIBLE_BRAND_CHIPS,
  type BrandChip,
} from '@/components/BrandChips';
import { Breadcrumb } from '@/components/Breadcrumb';
import { CarNotice } from '@/components/CarNotice';
import { CategoryEmpty } from '@/components/CategoryEmpty';
import { CategoryResultsPanel } from '@/components/CategoryResultsPanel';
import { CategorySort } from '@/components/CategorySort';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { CountsLine } from '@/components/CountsLine';
import { DemoNotice } from '@/components/DemoNotice';
import { fitMarkKind } from '@/components/FitMark';
import { ListingGroup, groupRuns } from '@/components/ListingGroup';
import { groupCopy } from '@/components/listing-group-copy';
import { ListingNote } from '@/components/ListingNote';
import { Pagination, type PaginationLink } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import { getCarContext, openedWithCoche, selectedSlug } from '@/server/car/context';
import { carLinks } from '@/server/car/return-path';
import { selectedVehicleId } from '@/server/car/state';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import {
  parseBrandParam,
  parseSortParam,
  sortParamValue,
  type CategorySort as CategorySortValue,
} from '@/server/catalogue/category-query';
import { parsePageParam } from '@/server/catalogue/page-param';
import { categoryListingPath, categoryPath, productPath, withCar } from '@/server/catalogue/paths';
import { pageSeo } from '@/server/catalogue/seo';
import { formatEuroCents } from '@/server/money';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// The order of the sort options, and the message key of each label.
const SORT_OPTIONS: { sort: CategorySortValue; labelKey: 'sortPriceAsc' | 'sortPriceDesc' | 'sortName' }[] = [
  { sort: 'price-asc', labelKey: 'sortPriceAsc' },
  { sort: 'price-desc', labelKey: 'sortPriceDesc' },
  { sort: 'name', labelKey: 'sortName' },
];

// Counts can reach four digits; es-ES drops the separator there unless asked.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

// One database read per request, shared by generateMetadata and the page.
const load = cache(getPublicCategoryPage);

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    pagina?: string | string[];
    marca?: string | string[];
    orden?: string | string[];
  }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { pagina, marca, orden } = await searchParams;
  const car = await getCarContext();
  const category = await load(
    slug,
    parsePageParam(pagina),
    parseBrandParam(marca),
    parseSortParam(orden),
    selectedVehicleId(car),
  );
  if (category === null) return {};
  const t = await getTranslations('Category');
  const values = { category: category.name, page: category.page, siteName: getSiteName() };
  return {
    title: category.page > 1 ? t('metaTitlePaged', values) : t('metaTitle', values),
    description: t('metaDescription', { category: category.name }),
    ...pageSeo(
      getPublicOrigin(),
      categoryPath(category.slug, category.page),
      category.indexable && !openedWithCoche(car),
    ),
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { pagina, marca, orden } = await searchParams;
  const car = await getCarContext();
  const category = await load(
    slug,
    parsePageParam(pagina),
    parseBrandParam(marca),
    parseSortParam(orden),
    selectedVehicleId(car),
  );
  if (category === null) notFound();

  const [t, tFit, tProduct, tNotFound, tDemo, tCar] = await Promise.all([
    getTranslations('Category'),
    getTranslations('Fit'),
    getTranslations('Product'),
    getTranslations('NotFound'),
    getTranslations('DemoNotice'),
    getTranslations('Car'),
  ]);
  // First child of every `main` below, ahead of the demo notice.
  const carNotice = car.state === 'unrecognised' ? <CarNotice text={tCar('unknownNotice')} /> : null;
  // What every internal link carries: the selected car, else nothing (D11).
  const carSlug = selectedSlug(car);
  // The fit view: only with a selected car, whose listing the loader filtered. Without one the page is as it was.
  const carFit =
    car.state === 'selected' && category.fit !== null
      ? { name: car.vehicle.name, counts: category.fit }
      : null;

  // The ancestors, root first, the category itself not listed: empty for a root, so no nav renders.
  const breadcrumb = (
    <Breadcrumb
      label={tProduct('breadcrumbLabel')}
      items={category.ancestors.map((crumb) => ({
        name: crumb.name,
        href: withCar(categoryPath(crumb.slug), carSlug),
      }))}
    />
  );

  if (category.state === 'empty-category') {
    return (
      <main className="page">
        {carNotice}
        {breadcrumb}
        <div className={styles.header}>
          <h1 className={styles.title}>{category.name}</h1>
        </div>
        <CategoryEmpty
          heading={t('emptyHeading')}
          body={t('emptyBody')}
          homeLabel={tNotFound('backHome')}
          homeHref={withCar('/', carSlug)}
        />
      </main>
    );
  }

  const selectedBrandSlug = category.selectedBrand?.slug ?? null;
  const sort = category.sort;
  // Every link keeps the sort and the brand it does not change. A page below 2 is the clean path.
  const pageHref = (page: number) =>
    withCar(categoryListingPath(category.slug, { brand: selectedBrandSlug, sort, page }), carSlug);
  const counts = {
    count: category.productCount,
    page: category.page,
    pages: category.pageCount,
  };

  const previous: PaginationLink | null =
    category.page > 1
      ? { href: pageHref(category.page - 1), label: t('previousPage') }
      : null;
  const next: PaginationLink | null =
    category.page < category.pageCount
      ? { href: pageHref(category.page + 1), label: t('nextPage') }
      : null;

  // With a car a chip counts what the page lists for it, so a brand with nothing listed has no chip.
  const listedBrands =
    carFit === null ? category.brands : category.brands.filter((brand) => brand.productCount > 0);
  // The brand group is for a choice: two brands or more.
  const toChip = (brand: (typeof category.brands)[number]): BrandChip => {
    const selected = brand.slug === selectedBrandSlug;
    const values = { brand: brand.label, count: brand.productCount };
    return {
      key: brand.slug,
      // The selected chip toggles the filter off; the others select their brand. Both start at page 1.
      href: withCar(
        categoryListingPath(category.slug, { brand: selected ? null : brand.slug, sort }),
        carSlug,
      ),
      label: brand.label,
      count: countFormat.format(brand.productCount),
      ariaLabel: selected ? t('brandChipSelectedLabel', values) : t('brandChipLabel', values),
      selected,
    };
  };
  const brandChips = listedBrands.map(toChip);
  // Two lists: a short one below 40rem and the long one from 40rem (BrandChips renders both).
  const toList = (visible: number) => {
    const moreChips = brandChips.slice(visible);
    return {
      chips: brandChips.slice(0, visible),
      moreChips,
      moreLabel: t('brandMore', { count: moreChips.length }),
    };
  };
  const brands =
    listedBrands.length >= 2 ? (
      <BrandChips
        groupLabel={t('brandGroupLabel')}
        // No chip is selected when the filter matched nothing: the way out is the action button.
        all={{
          href: withCar(categoryListingPath(category.slug, { sort }), carSlug),
          label: t('brandAll'),
          selected:
            (category.state === 'results' || category.state === 'all-left-out') &&
            selectedBrandSlug === null,
        }}
        narrow={toList(NARROW_BRAND_CHIPS)}
        wide={toList(VISIBLE_BRAND_CHIPS)}
      />
    ) : null;

  // Nothing to sort with no results.
  const sortControl =
    category.state === 'results' ? (
      <CategorySort
        action={categoryPath(category.slug)}
        label={t('sortLabel')}
        submitLabel={t('sortSubmit')}
        name="orden"
        options={SORT_OPTIONS.map((option) => ({
          value: sortParamValue(option.sort),
          label: t(option.labelKey),
        }))}
        selected={sortParamValue(sort)}
        hidden={[
          ...(selectedBrandSlug === null ? [] : [{ name: 'marca', value: selectedBrandSlug }]),
          ...(carSlug === null ? [] : [{ name: 'coche', value: carSlug }]),
        ]}
      />
    ) : null;

  // The counts line: one product count without a car; with one, fits, no data and hidden, then the page.
  const countsLine =
    carFit === null ? (
      category.pageCount > 1 ? (
        t('summaryPaged', counts)
      ) : (
        t('summary', counts)
      )
    ) : (
      <CountsLine
        parts={[
          tFit('countFits', { count: carFit.counts.fitsCount }),
          tFit('countUnknown', { count: countFormat.format(carFit.counts.unknownCount) }),
          tFit('countLeftOut', { count: carFit.counts.leftOutCount }),
          ...(category.pageCount > 1 ? [t('pageIndicator', counts)] : []),
        ]}
      />
    );

  const removeFilter = {
    href: withCar(categoryListingPath(category.slug, { sort }), carSlug),
    label: t('noMatchAction'),
  };

  // The card of one product. A card with a fit group sits in a listing group: h3 title, and the mark its group gives.
  const toCard = (product: (typeof category.products)[number]) => {
    const kind = fitMarkKind(product.fitGroup);
    return {
      key: product.slug,
      href: withCar(productPath(product.slug), carSlug),
      title: product.title,
      brand: product.brand,
      spec:
        product.partNumber === null ? null : t('specRef', { partNumber: product.partNumber }),
      // "Desde" only when the price is the lowest of several shops.
      priceFrom: product.offerCount >= 2 ? t('priceFrom') : null,
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

  let listing;
  if (category.state === 'no-match') {
    listing = (
      <CategoryEmpty heading={t('noMatchHeading')} body={t('noMatchBody')} action={removeFilter} />
    );
  } else if (category.state === 'all-left-out' && carFit !== null) {
    // Every product of the category or brand was hidden: the way out is another car (or no brand).
    const links = carLinks(car);
    const changeCar = {
      href: links.change ?? links.select,
      label: tFit('changeCar'),
      testId: 'fit-change-car',
    };
    listing = (
      <CategoryEmpty
        heading={t('allOutHeading', { car: carFit.name })}
        body={tFit('allOutBody', { count: carFit.counts.leftOutCount })}
        action={selectedBrandSlug === null ? changeCar : removeFilter}
        secondAction={selectedBrandSlug === null ? undefined : changeCar}
      />
    );
  } else if (carFit !== null) {
    const runs = groupRuns(category.products, (product) => {
      // The loader gives every card of a car listing a group; a card without one is a fault, never shown as a group.
      if (product.fitGroup === null) throw new Error('category: card without a fit group');
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
            {...groupCopy(tFit, run.group, carFit.name, null)}
          >
            <ProductGrid cards={run.items.map(toCard)} />
          </ListingGroup>
        ))}
      </>
    );
  } else {
    listing = <ProductGrid cards={category.products.map(toCard)} />;
  }

  return (
    <main className="page">
      {carNotice}
      {category.demoOnly && <DemoNotice text={tDemo('body')} />}
      {breadcrumb}
      <div className={styles.header}>
        <h1 className={styles.title}>{category.name}</h1>
        <p className={styles.note}>{tProduct('vatIncluded')}</p>
      </div>
      <CategoryResultsPanel
        brands={brands}
        count={countsLine}
        sort={sortControl}
      />
      {listing}
      {category.state === 'results' && category.pageCount > 1 ? (
        <Pagination
          navLabel={t('paginationLabel')}
          indicator={t('pageIndicator', counts)}
          previous={previous}
          next={next}
        />
      ) : null}
    </main>
  );
}
