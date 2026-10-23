import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AdminMessage } from '@/components/admin/AdminMessage';
import type { FeedRowView, ShopGroupView } from '@/components/admin/ShopGroup';
import { SourcesList } from '@/components/admin/SourcesList';
import { SourcesPage } from '@/components/admin/SourcesPage';
import { getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import { listSourcesForAdmin, type AdminFeed, type AdminShop } from '@/server/admin/sources';
import { requireAdminPage } from '@/server/auth/guard';

import { setFeedApprovalAction, setShopApprovalAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Next resolves metadata before the page body, so this is a server entry point of
  // an admin route: the role check comes first (guardrail 3). Cached per request.
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('sourcesTitle', { siteName: getSiteName() }) };
}

type Translate = Awaited<ReturnType<typeof getTranslations<'Admin.Sources'>>>;

// CLDR drops the separator on four digits; the design wants 1.234 ofertas.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

function feedView(feed: AdminFeed, shop: AdminShop, t: Translate): FeedRowView {
  const paused = feed.approved && !shop.approved;
  const offersText = countFormat.format(feed.offerCount);
  const metaParts = [
    feed.source === 'shop_upload'
      ? t('feedMetaUpload')
      : feed.networkName !== null
        ? t('feedMetaNetwork', { network: feed.networkName })
        : null,
    t('feedMetaOffers', { offers: feed.offerCount, offersText }),
    feed.demo ? t('feedMetaDemo') : null,
  ].filter((part): part is string => part !== null);
  const values = { id: feed.id, shop: shop.name };
  return {
    id: feed.id,
    title: t('feedTitle', { id: feed.id }),
    meta: metaParts.join(' · '),
    note: paused ? t('feedNotePaused') : null,
    approved: feed.approved,
    paused,
    labels: {
      tagApproved: t('feedApproved'),
      tagNotApproved: t('feedNotApproved'),
      tagPaused: t('feedPaused'),
      approve: t('feedApprove'),
      approving: t('feedApproving'),
      approveName: t('feedApproveName', values),
      disable: t('feedDisable'),
      disableName: t('feedDisableName', values),
      confirmTitle: t('confirmFeedTitle', values),
      confirmBody: t('confirmFeedBody'),
      confirmYes: t('confirmFeedYes'),
      confirmYesPending: t('feedDisabling'),
      cancel: t('confirmCancel'),
      doneApproved: t('doneFeedApproved'),
      doneDisabled: t('doneFeedDisabled'),
      doneApprovedPaused: t('doneFeedApprovedPaused'),
      errorTitle: t('errorTitle'),
      errorBody: t('errorFeedBody'),
    },
  };
}

function shopView(shop: AdminShop, t: Translate): ShopGroupView {
  const anyFeedApproved = shop.feeds.some((feed) => feed.approved);
  const note = !shop.approved
    ? anyFeedApproved
      ? t('shopNotePaused')
      : null
    : shop.feeds.length > 0 && !anyFeedApproved
      ? t('shopNoteNoApprovedFeed')
      : null;
  const values = { shop: shop.name };
  return {
    id: shop.id,
    title: shop.name,
    meta: t('shopMeta', {
      feeds: shop.feeds.length,
      offers: shop.offerCount,
      offersText: countFormat.format(shop.offerCount),
    }),
    note,
    approved: shop.approved,
    labels: {
      tagApproved: t('shopApproved'),
      tagNotApproved: t('shopNotApproved'),
      tagPaused: null,
      approve: t('shopApprove'),
      approving: t('shopApproving'),
      approveName: t('shopApproveName', values),
      disable: t('shopDisable'),
      disableName: t('shopDisableName', values),
      confirmTitle: t('confirmShopTitle', values),
      confirmBody: t('confirmShopBody'),
      confirmYes: t('confirmShopYes'),
      confirmYesPending: t('shopDisabling'),
      cancel: t('confirmCancel'),
      doneApproved: t('doneShopApproved'),
      doneDisabled: t('doneShopDisabled'),
      doneApprovedPaused: null,
      errorTitle: t('errorTitle'),
      errorBody: t('errorShopBody'),
    },
    feeds: shop.feeds.map((feed) => feedView(feed, shop, t)),
  };
}

export default async function AdminSourcesPage() {
  // The role check of this page (guardrail 3); the layout also checks, once per request.
  await requireAdminPage();
  const [t, shops] = await Promise.all([getTranslations('Admin.Sources'), listSourcesForAdmin()]);

  if (shops.length === 0) {
    return <AdminMessage heading={t('heading')} body={t('emptyBody')} />;
  }

  const feedCount = shops.reduce((sum, shop) => sum + shop.feeds.length, 0);
  return (
    <SourcesPage
      heading={t('heading')}
      intro={t('intro')}
      summary={t('summary', { shops: shops.length, feeds: feedCount })}
    >
      <SourcesList
        label={t('listLabel')}
        shops={shops.map((shop) => shopView(shop, t))}
        shopAction={setShopApprovalAction}
        feedAction={setFeedApprovalAction}
      />
    </SourcesPage>
  );
}
