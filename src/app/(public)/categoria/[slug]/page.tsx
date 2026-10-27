import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BrandChips, VISIBLE_BRAND_CHIPS, type BrandChip } from '@/components/BrandChips';
import { CategoryEmpty } from '@/components/CategoryEmpty';
import { CategoryResultsPanel } from '@/components/CategoryResultsPanel';
import { CategorySort } from '@/components/CategorySort';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { DemoNotice } from '@/components/DemoNotice';
import { Pagination, type PaginationLink } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import {
  parseBrandParam,
  parseSortParam,
  sortParamValue,
  type CategorySort as CategorySortValue,
} from '@/server/catalogue/category-query';
import { parsePageParam } from '@/server/catalogue/page-param';
import { categoryListingPath, categoryPath, productPath } from '@/server/catalogue/paths';
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
  const category = await load(
    slug,
    parsePageParam(pagina),
    parseBrandParam(marca),
    parseSortParam(orden),
  );
  if (category === null) return {};
  const t = await getTranslations('Category');
  const values = { category: category.name, page: category.page, siteName: getSiteName() };
  return {
    title: category.page > 1 ? t('metaTitlePaged', values) : t('metaTitle', values),
    description: t('metaDescription', { category: category.name }),
    ...pageSeo(getPublicOrigin(), categoryPath(category.slug, category.page), category.indexable),
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { pagina, marca, orden } = await searchParams;
  const category = await load(
    slug,
    parsePageParam(pagina),
    parseBrandParam(marca),
    parseSortParam(orden),
  );
  if (category === null) notFound();

  const [t, tProduct, tNotFound, tDemo] = await Promise.all([
    getTranslations('Category'),
    getTranslations('Product'),
    getTranslations('NotFound'),
    getTranslations('DemoNotice'),
  ]);

  if (category.state === 'empty-category') {
    return (
      <main className="page">
        <div className={styles.header}>
          <h1 className={styles.title}>{category.name}</h1>
        </div>
        <CategoryEmpty
          heading={t('emptyHeading')}
          body={t('emptyBody')}
          homeLabel={tNotFound('backHome')}
        />
      </main>
    );
  }

  const selectedBrandSlug = category.selectedBrand?.slug ?? null;
  const sort = category.sort;
  // Every link keeps the sort and the brand it does not change. A page below 2 is the clean path.
  const pageHref = (page: number) =>
    categoryListingPath(category.slug, { brand: selectedBrandSlug, sort, page });
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

  // The brand group is for a choice: two brands or more.
  const toChip = (brand: (typeof category.brands)[number]): BrandChip => {
    const selected = brand.slug === selectedBrandSlug;
    const values = { brand: brand.label, count: brand.productCount };
    return {
      key: brand.slug,
      // The selected chip toggles the filter off; the others select their brand. Both start at page 1.
      href: categoryListingPath(category.slug, { brand: selected ? null : brand.slug, sort }),
      label: brand.label,
      count: countFormat.format(brand.productCount),
      ariaLabel: selected ? t('brandChipSelectedLabel', values) : t('brandChipLabel', values),
      selected,
    };
  };
  const brandChips = category.brands.map(toChip);
  const moreChips = brandChips.slice(VISIBLE_BRAND_CHIPS);
  const brands =
    category.brands.length >= 2 ? (
      <BrandChips
        groupLabel={t('brandGroupLabel')}
        // No chip is selected when the filter matched nothing: the way out is the action button.
        all={{
          href: categoryListingPath(category.slug, { sort }),
          label: t('brandAll'),
          selected: category.state === 'results' && selectedBrandSlug === null,
        }}
        chips={brandChips.slice(0, VISIBLE_BRAND_CHIPS)}
        moreChips={moreChips}
        moreLabel={t('brandMore', { count: moreChips.length })}
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
        hidden={selectedBrandSlug === null ? null : { name: 'marca', value: selectedBrandSlug }}
      />
    ) : null;

  return (
    <main className="page">
      {category.demoOnly && <DemoNotice text={tDemo('body')} />}
      <div className={styles.header}>
        <h1 className={styles.title}>{category.name}</h1>
        <p className={styles.note}>{tProduct('vatIncluded')}</p>
      </div>
      <CategoryResultsPanel
        brands={brands}
        count={category.pageCount > 1 ? t('summaryPaged', counts) : t('summary', counts)}
        sort={sortControl}
      />
      {category.state === 'no-match' ? (
        <CategoryEmpty
          heading={t('noMatchHeading')}
          body={t('noMatchBody')}
          action={{
            href: categoryListingPath(category.slug, { sort }),
            label: t('noMatchAction'),
          }}
        />
      ) : (
        <ProductGrid
          cards={category.products.map((product) => ({
            key: product.slug,
            href: productPath(product.slug),
            title: product.title,
            brand: product.brand,
            spec:
              product.partNumber === null
                ? null
                : t('specRef', { partNumber: product.partNumber }),
            // "Desde" only when the price is the lowest of several shops.
            priceFrom: product.offerCount >= 2 ? t('priceFrom') : null,
            price: formatEuroCents(product.lowestPriceCents),
            shopCount: tProduct('shopCount', { count: product.offerCount }),
            illustration: toIllustrationKey(product.categorySlug),
          }))}
        />
      )}
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
