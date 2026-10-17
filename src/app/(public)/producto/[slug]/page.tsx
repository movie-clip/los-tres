import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { OfferList } from '@/components/OfferList';
import { ProductDetails, type ProductDetail } from '@/components/ProductDetails';
import { getSiteName } from '@/config/site';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
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
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await load(slug);
  if (product === null) notFound();

  const t = await getTranslations('Product');

  // A null detail is left out entirely, never shown as empty.
  const details: ProductDetail[] = [];
  if (product.brand !== null) details.push({ label: t('brand'), value: product.brand });
  if (product.partNumber !== null) {
    details.push({ label: t('partNumber'), value: product.partNumber });
  }
  if (product.ean !== null) details.push({ label: t('ean'), value: product.ean });

  return (
    <main className="page">
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
        }))}
      />
    </main>
  );
}
