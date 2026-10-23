import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DemoNotice } from '@/components/DemoNotice';
import { JsonLd } from '@/components/JsonLd';
import { OfferList } from '@/components/OfferList';
import { ProductDetails, type ProductDetail } from '@/components/ProductDetails';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { productPath } from '@/server/catalogue/paths';
import { buildProductJsonLd } from '@/server/catalogue/product-jsonld';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { pageSeo } from '@/server/catalogue/seo';
import { goPath } from '@/server/clicks/go-path';
import { formatEuroCents } from '@/server/money';

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

  const [t, tDemo] = await Promise.all([
    getTranslations('Product'),
    getTranslations('DemoNotice'),
  ]);

  // A null detail is left out entirely, never shown as empty.
  const details: ProductDetail[] = [];
  if (product.brand !== null) details.push({ label: t('brand'), value: product.brand });
  if (product.partNumber !== null) {
    details.push({ label: t('partNumber'), value: product.partNumber });
  }
  if (product.ean !== null) details.push({ label: t('ean'), value: product.ean });

  // Null when no offer is visible: then no script tag is rendered at all.
  const jsonLd = buildProductJsonLd(product);

  return (
    <>
      {jsonLd !== null && <JsonLd data={jsonLd} />}
      <main className="page">
        {product.demoOnly && <DemoNotice text={tDemo('body')} />}
        <ProductDetails
          title={product.title}
          imageLabel={t('imagePlaceholder')}
          details={details}
          description={product.description}
        />
        <OfferList
          heading={t('offersHeading')}
          shopCount={t('shopCount', { count: product.offers.length })}
          vatNote={t('vatIncluded')}
          offers={product.offers.map((offer) => ({
            key: String(offer.offerId),
            shopName: offer.shopName,
            price: formatEuroCents(offer.priceCents),
            updated: t('priceUpdatedOn', { date: offer.priceUpdatedAt }),
            goHref: goPath(offer.offerId),
            goLabel: t('goToShop', { shopName: offer.shopName }),
          }))}
        />
      </main>
    </>
  );
}
