import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Breadcrumb } from '@/components/Breadcrumb';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { DemoNotice } from '@/components/DemoNotice';
import { JsonLd } from '@/components/JsonLd';
import { OfferList } from '@/components/OfferList';
import { ProductDescription } from '@/components/ProductDescription';
import { ProductHero, type ProductDetail } from '@/components/ProductHero';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { categoryPath, productPath } from '@/server/catalogue/paths';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { pageSeo } from '@/server/catalogue/seo';
import { goPath } from '@/server/clicks/go-path';
import { formatEuroCents } from '@/server/money';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// One database read per request, shared by generateMetadata and the page.
const load = cache(getPublicProductBySlug);

type ProductPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await load(slug);
  if (product === null) return {};
  const t = await getTranslations('Product');
  return {
    title: t('metaTitle', { title: product.title, siteName: getSiteName() }),
    description: t('metaDescription', { title: product.title }),
    ...pageSeo(getPublicOrigin(), productPath(product.slug), product.indexable),
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await load(slug);
  if (product === null) notFound();

  const [t, tCategory, tDemo] = await Promise.all([
    getTranslations('Product'),
    getTranslations('Category'),
    getTranslations('DemoNotice'),
  ]);

  // A null detail is left out entirely, never shown as empty.
  const details: ProductDetail[] = [];
  if (product.partNumber !== null) {
    details.push({ label: t('partNumber'), value: product.partNumber });
  }
  if (product.ean !== null) details.push({ label: t('ean'), value: product.ean });

  // The product's own leaf: an unknown or root slug keeps the plain square.
  const illustration = toIllustrationKey(product.categorySlug);
  const imageLabel = illustration
    ? t(`imageByCategory.${illustration}`)
    : t('imagePlaceholder');

  // Null when no offer is visible: then no script tag is rendered at all.
  const jsonLd = buildProductJsonLd(product);

  return (
    <>
      {jsonLd !== null && <JsonLd data={jsonLd} />}
      <main className="page">
        {product.demoOnly && <DemoNotice text={tDemo('body')} />}
        <Breadcrumb
          label={t('breadcrumbLabel')}
          items={product.categoryTrail.map((crumb) => ({
            name: crumb.name,
            href: categoryPath(crumb.slug),
          }))}
        />
        <div className={styles.layout}>
          <ProductHero
            title={product.title}
            brand={product.brand}
            imageLabel={imageLabel}
            illustration={illustration}
            details={details}
            priceLabel={product.offers.length >= 2 ? tCategory('priceFrom') : null}
            price={formatEuroCents(product.offers[0].priceCents)}
            shopCount={t('shopCount', { count: product.offers.length })}
            vatNote={t('vatIncluded')}
          />
          <OfferList
            heading={t('offersHeading')}
            bestPriceLabel={t('bestPrice')}
            offers={product.offers.map((offer) => ({
              key: String(offer.offerId),
              shopName: offer.shopName,
              price: formatEuroCents(offer.priceCents),
              updated: t('priceUpdatedOn', { date: offer.priceUpdatedAt }),
              goHref: goPath(offer.offerId),
              goLabel: t('goToShopShort'),
              goAccessibleName: t('goToShop', { shopName: offer.shopName }),
              isBestPrice: offer.isBestPrice,
            }))}
          />
          {product.description !== null ? (
            <ProductDescription
              heading={t('descriptionHeading')}
              text={product.description}
            />
          ) : null}
        </div>
      </main>
    </>
  );
}
