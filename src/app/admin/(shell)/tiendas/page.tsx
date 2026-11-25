import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CreateToolbar } from '@/components/admin/CreateToolbar';
import { EmptyList } from '@/components/admin/EmptyList';
import { NetworkList, type NetworkView } from '@/components/admin/NetworkList';
import { NetworksSection } from '@/components/admin/NetworksSection';
import type { FeedRowView, ShopGroupView } from '@/components/admin/ShopGroup';
import { SourcesList } from '@/components/admin/SourcesList';
import { SourcesPage } from '@/components/admin/SourcesPage';
import { getSiteName } from '@/config/site';
import { LOCALE } from '@/i18n/locale';
import { isSourceNotice, type SourceNotice } from '@/server/admin/source-rules';
import {
  listNetworksForAdmin,
  listSourcesForAdmin,
  type AdminFeed,
  type AdminNetwork,
  type AdminShop,
} from '@/server/admin/sources';
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
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SOURCES_PATH = '/admin/tiendas';

/** The message key of each notice the redirect after a save may carry (05-ux section 6). */
const NOTICE_KEYS = {
  'red-creada': 'noticeNetworkCreated',
  'red-guardada': 'noticeNetworkSaved',
  'tienda-creada': 'noticeShopCreated',
  'tienda-guardada': 'noticeShopSaved',
  'feed-creado': 'noticeFeedCreated',
  'feed-guardado': 'noticeFeedSaved',
  'feed-sin-aprobar': 'noticeFeedUnapproved',
} as const satisfies Record<SourceNotice, string>;

// CLDR drops the separator on four digits; the design wants 1.234 ofertas.
const countFormat = new Intl.NumberFormat(LOCALE, { useGrouping: 'always' });

function feedView(feed: AdminFeed, shop: AdminShop, t: Translate): FeedRowView {
  const paused = feed.approved && !shop.approved;
  const offersText = countFormat.format(feed.offerCount);
  // The kind of feed decides the identity line and the meta line (S3.7, C-7, S12.2); "Subido por la tienda"
  // is only for a stored shop upload, never the fallback for a feed with no network.
  const isFile = feed.source === 'catalogue_file' || feed.source === 'collected_file';
  const metaParts = [
    feed.source === 'collected_file'
      ? t('feedMetaCollected')
      : feed.source === 'catalogue_file'
        ? t('feedMetaFile')
        : feed.source === 'shop_upload'
          ? t('feedMetaUpload')
          : feed.networkName !== null
            ? t('feedMetaNetwork', { network: feed.networkName })
            : null,
    t('feedMetaOffers', { offers: feed.offerCount, offersText }),
    // The offers on the site now (S2.6); written as a number, 0 included.
    t('offersOnSite', { countText: countFormat.format(feed.onSiteOfferCount) }),
  ].filter((part): part is string => part !== null);
  const values = { id: feed.id, shop: shop.name };
  // The file name or a fixed phrase for either file kind; the host or a fixed phrase otherwise. The stored
  // value is never a fallback (AC 24).
  const valueLine = isFile
    ? { label: t('fileLabel'), value: feed.fileName ?? t('fileUnavailable') }
    : { label: t('domainLabel'), value: feed.host ?? (feed.demo ? t('domainNone') : t('domainUnavailable')) };
  return {
    id: feed.id,
    title: t('feedTitle', { id: feed.id }),
    meta: metaParts.join(' · '),
    note: paused ? t('feedNotePaused') : null,
    approved: feed.approved,
    paused,
    extras: {
      demo: feed.demo,
      demoLabel: t('demoMark'),
      valueLine,
      // A shop upload has no form (D-T12): no edit link.
      links:
        feed.source === 'affiliate_network' || isFile
          ? [{ href: `${SOURCES_PATH}/feed/${feed.id}/editar`, label: t('editFeed'), ariaLabel: t('editFeedName', values) }]
          : [],
    },
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
    meta: `${t('shopMeta', {
      feeds: shop.feeds.length,
      offers: shop.offerCount,
      offersText: countFormat.format(shop.offerCount),
    })} · ${t('offersOnSite', { countText: countFormat.format(shop.onSiteOfferCount) })}`,
    note,
    approved: shop.approved,
    noFeeds: t('shopNoFeeds'),
    extras: {
      demo: shop.demo,
      demoLabel: t('demoMark'),
      valueLine: { label: t('slugLabel'), value: shop.slug },
      links: [
        { href: `${SOURCES_PATH}/tienda/${shop.id}/editar`, label: t('editShop'), ariaLabel: t('editShopName', values) },
        { href: `${SOURCES_PATH}/feed/nuevo?tienda=${shop.id}`, label: t('addFeed'), ariaLabel: t('addFeedName', values) },
      ],
    },
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

function networkView(network: AdminNetwork, t: Translate): NetworkView {
  return {
    id: network.id,
    name: network.name,
    slugLabel: t('slugLabel'),
    slug: network.slug,
    demo: network.demo,
    editHref: `${SOURCES_PATH}/red/${network.id}/editar`,
    editLabel: t('editNetwork'),
    editName: t('editNetworkName', { network: network.name }),
  };
}

export default async function AdminSourcesPage({ searchParams }: { searchParams: SearchParams }) {
  // The role check of this page (guardrail 3); the layout also checks, once per request.
  // `aviso` is read only after it: an anonymous request is redirected before any of it.
  await requireAdminPage();
  const [t, shops, networks, params] = await Promise.all([
    getTranslations('Admin.Sources'),
    listSourcesForAdmin(),
    listNetworksForAdmin(),
    searchParams,
  ]);
  const aviso = Array.isArray(params.aviso) ? params.aviso[0] : params.aviso;
  const notice = isSourceNotice(aviso) ? t(NOTICE_KEYS[aviso]) : null;

  const feedCount = shops.reduce((sum, shop) => sum + shop.feeds.length, 0);
  return (
    <SourcesPage
      heading={t('heading')}
      notice={notice}
      intro={t('intro')}
      summary={t('summary', { shops: shops.length, feeds: feedCount })}
    >
      <CreateToolbar
        label={t('createGroupLabel')}
        links={[
          { href: `${SOURCES_PATH}/tienda/nueva`, label: t('addShop'), testId: 'add-shop' },
          { href: `${SOURCES_PATH}/feed/nuevo`, label: t('addFeed'), testId: 'add-feed' },
        ]}
      />
      {shops.length === 0 ? (
        <EmptyList text={t('shopsEmpty')} testId="shops-empty" />
      ) : (
        <SourcesList
          label={t('listLabel')}
          shops={shops.map((shop) => shopView(shop, t))}
          shopAction={setShopApprovalAction}
          feedAction={setFeedApprovalAction}
        />
      )}
      <NetworksSection
        heading={t('networksHeading')}
        count={t('networksCount', { count: networks.length })}
        add={{ href: `${SOURCES_PATH}/red/nueva`, label: t('addNetwork') }}
      >
        {networks.length === 0 ? (
          <EmptyList text={t('networksEmpty')} testId="networks-empty" />
        ) : (
          <NetworkList
            label={t('networksListLabel')}
            demoLabel={t('demoMark')}
            networks={networks.map((network) => networkView(network, t))}
          />
        )}
      </NetworksSection>
    </SourcesPage>
  );
}
