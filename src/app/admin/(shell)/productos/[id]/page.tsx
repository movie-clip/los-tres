import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { ProductBox } from '@/components/admin/ProductBox';
import { ProductDetailPage } from '@/components/admin/ProductDetailPage';
import { ProductHideToggle, type ProductHideLabels } from '@/components/admin/ProductHideToggle';
import { ProductIdentifiers } from '@/components/admin/ProductIdentifiers';
import { ProductOfferRow } from '@/components/admin/ProductOfferRow';
import { ProductOffersSection } from '@/components/admin/ProductOffersSection';
import { reasonLabels } from '@/components/admin/product-reason-labels';
import { getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import { adminProductListHref, parseAdminProductListQuery } from '@/server/admin/product-rules';
import { readProductForAdmin, type AdminOfferRow } from '@/server/admin/products';
import { parseId } from '@/server/admin/source-rules';
import { requireAdminPage } from '@/server/auth/guard';
import { formatEuroCents } from '@/server/money';

import { setOfferHiddenAction, setProductHiddenAction } from '../actions';

export const dynamic = 'force-dynamic';

// One read per request, shared by `generateMetadata` and the page.
const load = cache((id: number) => readProductForAdmin(id));

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  q?: string | string[];
  ocultos?: string | string[];
  pagina?: string | string[];
}>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  const siteName = getSiteName();
  // The production build keeps the page's own title when the page throws notFound(), so the
  // not-found title is decided here: an id that does not parse, or has no row, is the 404.
  const id = parseId((await params).id);
  const product = id === null ? null : await load(id);
  if (!product) return { title: t('notFoundTitle', { siteName }) };
  return { title: t('productTitle', { title: product.title, siteName }) };
}

// CLDR drops the separator on four digits; the design wants 1.234 ofertas.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

export default async function AdminProductPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  // The role check first, then the id: an anonymous request is redirected before `params` is read.
  await requireAdminPage();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const product = await load(id);
  if (!product) notFound();

  const [t, d] = await Promise.all([getTranslations('Admin.Products'), getTranslations('Admin.Products.Detail')]);
  // The list state rides in this page's own address; the way back rebuilds that list (AC 31).
  const back = adminProductListHref(parseAdminProductListQuery(await searchParams));

  const shared = {
    publicLabel: t('publicNowLabel'),
    publicYes: t('publicNowYes'),
    publicNo: t('publicNowNo'),
    reasonLabel: t('reasonLabel'),
    reasons: reasonLabels(t),
    saving: d('saving'),
    errorTitle: d('errorTitle'),
  };
  const productLabels: ProductHideLabels = {
    ...shared,
    tagHidden: t('tagHidden'),
    tagNotHidden: t('tagNotHidden'),
    hide: d('hideProduct'),
    hideName: null,
    unhide: d('unhideProduct'),
    unhideName: null,
    doneHidden: d('doneProductHidden'),
    doneUnhidden: d('doneProductUnhidden'),
    errorBody: d('errorProductBody'),
    goneBody: d('goneProductBody'),
  };
  const offerLabels = (offer: AdminOfferRow): ProductHideLabels => ({
    ...shared,
    tagHidden: t('tagOfferHidden'),
    tagNotHidden: t('tagOfferNotHidden'),
    hide: d('hideOffer'),
    hideName: d('hideOfferName', { shop: offer.shopName, id: offer.feedId }),
    unhide: d('unhideOffer'),
    unhideName: d('unhideOfferName', { shop: offer.shopName, id: offer.feedId }),
    doneHidden: d('doneOfferHidden'),
    doneUnhidden: d('doneOfferUnhidden'),
    errorBody: d('errorOfferBody'),
    goneBody: d('goneOfferBody'),
  });

  const identifiers = [
    product.brand !== null ? { label: t('brandLabel'), value: product.brand, testId: 'product-brand' } : null,
    product.partNumber !== null
      ? { label: t('partNumberLabel'), value: product.partNumber, testId: 'product-part-number' }
      : null,
    product.ean !== null ? { label: t('eanLabel'), value: product.ean, testId: 'product-ean' } : null,
    { label: t('slugLabel'), value: product.slug, testId: 'product-slug' },
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  const offerCount = product.offers.length;
  return (
    <ProductDetailPage back={{ href: back, label: d('backLink') }} heading={product.title} intro={d('intro')}>
      <ProductBox heading={d('productHeading')}>
        <ProductHideToggle
          kind="product"
          id={product.id}
          hidden={product.hidden}
          publicNow={product.publicNow}
          reason={product.reason}
          labels={productLabels}
          action={setProductHiddenAction}
        >
          <ProductIdentifiers items={identifiers} />
        </ProductHideToggle>
      </ProductBox>
      <ProductOffersSection
        heading={d('offersHeading')}
        count={d('offersCount', { count: offerCount, countText: countFormat.format(offerCount) })}
        intro={offerCount > 0 ? d('offersIntro') : null}
        listLabel={d('offersListLabel')}
        empty={offerCount === 0 ? d('offersEmpty') : null}
      >
        {product.offers.map((offer) => (
          <ProductOfferRow
            key={offer.id}
            shopName={offer.shopName}
            price={formatEuroCents(offer.priceCents)}
            feedLine={d('offerFeed', { id: offer.feedId })}
          >
            <ProductHideToggle
              kind="offer"
              id={offer.id}
              hidden={offer.hidden}
              publicNow={offer.publicNow}
              reason={offer.reason}
              labels={offerLabels(offer)}
              action={setOfferHiddenAction}
            />
          </ProductOfferRow>
        ))}
      </ProductOffersSection>
    </ProductDetailPage>
  );
}
