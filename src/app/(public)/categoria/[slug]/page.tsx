import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CategoryEmpty } from '@/components/CategoryEmpty';
import { DemoNotice } from '@/components/DemoNotice';
import { Pagination, type PaginationLink } from '@/components/Pagination';
import { ProductGrid } from '@/components/ProductGrid';
import { getSiteName } from '@/config/site';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { parsePageParam } from '@/server/catalogue/page-param';
import { formatEuroCents } from '@/server/money';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// One database read per request, shared by generateMetadata and the page.
const load = cache(getPublicCategoryPage);

type CategoryPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ pagina?: string | string[] }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { pagina } = await searchParams;
  const category = await load(slug, parsePageParam(pagina));
  if (category === null) return {};
  const t = await getTranslations('Category');
  const values = { category: category.name, page: category.page, siteName: getSiteName() };
  return {
    title: category.page > 1 ? t('metaTitlePaged', values) : t('metaTitle', values),
    description: t('metaDescription', { category: category.name }),
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { pagina } = await searchParams;
  const category = await load(slug, parsePageParam(pagina));
  if (category === null) notFound();

  const [t, tProduct, tNotFound, tDemo] = await Promise.all([
    getTranslations('Category'),
    getTranslations('Product'),
    getTranslations('NotFound'),
    getTranslations('DemoNotice'),
  ]);

  if (category.productCount === 0) {
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

  const basePath = `/categoria/${category.slug}`;
  // Page 1 is the clean category URL, never ?pagina=1.
  const pageHref = (page: number) => (page === 1 ? basePath : `${basePath}?pagina=${page}`);
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

  return (
    <main className="page">
      {category.demoOnly && <DemoNotice text={tDemo('body')} />}
      <div className={styles.header}>
        <h1 className={styles.title}>{category.name}</h1>
        <p className={styles.note} data-testid="category-summary">
          {category.pageCount > 1 ? t('summaryPaged', counts) : t('summary', counts)}
        </p>
        <p className={styles.note}>{tProduct('vatIncluded')}</p>
      </div>
      <ProductGrid
        cards={category.products.map((product) => ({
          key: product.slug,
          href: `/producto/${product.slug}`,
          title: product.title,
          brand: product.brand,
          // "Desde" only when the price is the lowest of several shops.
          priceFrom: product.offerCount >= 2 ? t('priceFrom') : null,
          price: formatEuroCents(product.lowestPriceCents),
          shopCount: tProduct('shopCount', { count: product.offerCount }),
        }))}
      />
      {category.pageCount > 1 ? (
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
