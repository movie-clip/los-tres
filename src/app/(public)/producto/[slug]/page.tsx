import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { Breadcrumb } from '@/components/Breadcrumb';
import { toIllustrationKey } from '@/components/CategoryIllustration';
import { CarNotice } from '@/components/CarNotice';
import { DemoNotice } from '@/components/DemoNotice';
import { FitBanner } from '@/components/FitBanner';
import { JsonLd } from '@/components/JsonLd';
import { OfferList } from '@/components/OfferList';
import {
  APPROVALS_VISIBLE,
  ProductAttributes,
  type ProductAttributeRow,
} from '@/components/ProductAttributes';
import { ProductDescription } from '@/components/ProductDescription';
import { ProductHero, type ProductDetail } from '@/components/ProductHero';
import { VehicleList } from '@/components/VehicleList';
import { VEHICLE_LIST_VISIBLE, type VehicleListRow } from '@/components/vehicle-list-groups';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { getCarContext, openedWithCoche, selectedSlug } from '@/server/car/context';
import { categoryPath, productPath, withCar } from '@/server/catalogue/paths';
import { getProductFit, type ProductFitBanner } from '@/server/catalogue/product-fit';
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
  const [t, car] = await Promise.all([getTranslations('Product'), getCarContext()]);
  return {
    title: t('metaTitle', { title: product.title, siteName: getSiteName() }),
    description: t('metaDescription', { title: product.title }),
    ...pageSeo(
      getPublicOrigin(),
      productPath(product.slug),
      product.indexable && !openedWithCoche(car),
    ),
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await load(slug);
  if (product === null) notFound();

  const [t, tCategory, tDemo, tCar, tFit, tProductFit, tPicker, car] = await Promise.all([
    getTranslations('Product'),
    getTranslations('Category'),
    getTranslations('DemoNotice'),
    getTranslations('Car'),
    getTranslations('Fit'),
    getTranslations('ProductFit'),
    getTranslations('CarPicker'),
    getCarContext(),
  ]);

  // The product is public here, so the fit read may run. It never throws: a failed
  // read comes back as 'unchecked'. Null (no banner) unless a car is selected.
  const fit = await getProductFit(product.slug, car);
  const carName = car.state === 'selected' ? car.vehicle.name : '';
  const bannerText: Record<ProductFitBanner, string> = {
    fits: tProductFit('bannerFits', { car: carName }),
    'no-fit': tProductFit('bannerNoFit', { car: carName }),
    unknown: tProductFit('bannerUnknown'),
    unchecked: tProductFit('bannerUnchecked'),
  };

  // The vehicle rows, finished here: [] for no counted fitment and for a failed read,
  // and the page draws no card for either. Each href carries the row's own vehicle in
  // `coche`, whatever car is selected; the tag compares slugs from the car context.
  const selected = selectedSlug(car);
  const vehicleRows: VehicleListRow[] = (fit.vehicles ?? []).map((vehicle) => ({
    key: vehicle.slug,
    groupKey: vehicle.modelSlug,
    groupName: tProductFit('groupName', {
      make: vehicle.make,
      model: vehicle.model,
      generation: vehicle.generation,
    })
      .replace(/\s+/g, ' ')
      .trim(),
    engine: vehicle.engine,
    detail: tProductFit('rowDetail', {
      fuelPower: tPicker('engineDetail', {
        fuel: tPicker(`fuel.${vehicle.fuel}`),
        power: String(vehicle.powerCv),
      }),
      years:
        vehicle.yearTo === null
          ? tPicker('yearsOngoing', { from: String(vehicle.yearFrom) })
          : tPicker('years', { from: String(vehicle.yearFrom), to: String(vehicle.yearTo) }),
    }),
    href: withCar(categoryPath(product.categorySlug), vehicle.slug),
    isSelectedCar: selected !== null && vehicle.slug === selected,
  }));
  const hiddenVehicles = vehicleRows.length - VEHICLE_LIST_VISIBLE;

  // A null detail is left out entirely, never shown as empty.
  const details: ProductDetail[] = [];
  if (product.partNumber !== null) {
    details.push({ label: t('partNumber'), value: product.partNumber });
  }
  if (product.ean !== null) details.push({ label: t('ean'), value: product.ean });

  // The attribute rows, finished here, in the spec's order; an absent attribute draws
  // no row. The reader returns null outside aceite-de-motor and when none is held,
  // and then the page draws no card.
  const attributes = product.attributes;
  const attributeRows: ProductAttributeRow[] = [];
  if (attributes !== null) {
    if (attributes.viscosity !== null) {
      attributeRows.push({
        key: 'viscosity',
        kind: 'value',
        label: t('attributeLabel.viscosity'),
        value: attributes.viscosity,
      });
    }
    if (attributes.volume !== null) {
      attributeRows.push({
        key: 'volume',
        kind: 'value',
        label: t('attributeLabel.volume'),
        value: attributes.volume,
      });
    }
    if (attributes.acea !== null) {
      attributeRows.push({
        key: 'acea',
        kind: 'tokens',
        label: t('attributeLabel.acea'),
        tokens: attributes.acea,
      });
    }
    if (attributes.oilType !== null) {
      attributeRows.push({
        key: 'oilType',
        kind: 'value',
        label: t('attributeLabel.oilType'),
        value: t(`oilType.${attributes.oilType}`),
      });
    }
    if (attributes.approvals !== null) {
      const hiddenApprovals = attributes.approvals.length - APPROVALS_VISIBLE;
      attributeRows.push({
        key: 'approvals',
        kind: 'list',
        label: t('attributeLabel.approvals'),
        items: attributes.approvals,
        moreLabel: hiddenApprovals > 0 ? t('approvalsMore', { count: hiddenApprovals }) : null,
        fewerLabel: t('approvalsFewer'),
      });
    }
  }

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
        {car.state === 'unrecognised' && <CarNotice text={tCar('unknownNotice')} />}
        {product.demoOnly && <DemoNotice text={tDemo('body')} />}
        <Breadcrumb
          label={t('breadcrumbLabel')}
          items={product.categoryTrail.map((crumb) => ({
            name: crumb.name,
            href: withCar(categoryPath(crumb.slug), selectedSlug(car)),
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
          {fit.banner !== null && (
            <FitBanner
              kind={fit.banner}
              text={bannerText[fit.banner]}
              help={fit.banner === 'unknown' ? tFit('unknownHelp') : null}
              link={
                fit.banner === 'no-fit' && car.state === 'selected'
                  ? {
                      href: withCar(categoryPath(product.categorySlug), car.vehicle.slug),
                      label: tProductFit('bannerNoFitLink'),
                    }
                  : null
              }
            />
          )}
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
          {attributeRows.length > 0 && (
            <ProductAttributes heading={t('attributesHeading')} rows={attributeRows} />
          )}
          {vehicleRows.length > 0 && (
            <VehicleList
              heading={tProductFit('listHeading')}
              help={tProductFit('listHelp')}
              rows={vehicleRows}
              yourCarLabel={tProductFit('yourCar')}
              moreLabel={
                hiddenVehicles > 0 ? tProductFit('moreVehicles', { count: hiddenVehicles }) : null
              }
              fewerLabel={tProductFit('fewerVehicles')}
            />
          )}
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
