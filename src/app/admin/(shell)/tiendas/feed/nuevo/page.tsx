import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FeedForm } from '@/components/admin/FeedForm';
import { FormScreen } from '@/components/admin/FormScreen';
import { InfoBlock } from '@/components/admin/InfoBlock';
import { LinkButton } from '@/components/admin/LinkButton';
import { feedFormLabels, fileKindsText } from '@/components/admin/source-form-labels';
import { getSiteName } from '@/config/site';
import { FEED_URL_MAX, NAME_MAX, SLUG_MAX, parseId } from '@/server/admin/source-rules';
import { listNetworksForAdmin, listSourcesForAdmin } from '@/server/admin/sources';
import { requireAdminPage } from '@/server/auth/guard';
import { CATALOGUE_FILE_KINDS, CATALOGUE_FILE_NAME_MAX } from '@/server/catalogue-file-name';

import { createFeedAction } from '../../actions';

export const dynamic = 'force-dynamic';

const SOURCES_PATH = '/admin/tiendas';

export async function generateMetadata(): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('newFeedTitle', { siteName: getSiteName() }) };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewFeedPage({ searchParams }: { searchParams: SearchParams }) {
  // The role check first, then `?tienda=`: an anonymous request is redirected before it is read.
  await requireAdminPage();
  const [t, sources, shops, networks, params] = await Promise.all([
    getTranslations('Admin.Form'),
    getTranslations('Admin.Sources'),
    listSourcesForAdmin(),
    listNetworksForAdmin(),
    searchParams,
  ]);
  const back = { href: SOURCES_PATH, label: t('backLink') };

  // A feed of either source needs a shop: with none there is no form to submit (AC 38). A missing network
  // blocks only the https source, inside the form (S3.7).
  if (shops.length === 0) {
    return (
      <FormScreen heading={t('Feed.headingNew')} intro={t('Feed.introNew')}>
        <InfoBlock title={t('Feed.missingShopTitle')} body={t('Feed.missingShopBody')} testId="missing-shop">
          <LinkButton href={`${SOURCES_PATH}/tienda/nueva`} label={sources('addShop')} />
        </InfoBlock>
        <div>
          <LinkButton href={back.href} label={back.label} testId="form-back-button" />
        </div>
      </FormScreen>
    );
  }

  // An unknown or malformed `?tienda=` preselects nothing.
  const wanted = parseId(Array.isArray(params.tienda) ? params.tienda[0] : params.tienda);
  const defaultShopId = wanted !== null && shops.some((shop) => shop.id === wanted) ? String(wanted) : '';

  return (
    <FormScreen back={back} heading={t('Feed.headingNew')} intro={t('Feed.introNew')}>
      <FeedForm
        mode="create"
        action={createFeedAction}
        cancelHref={SOURCES_PATH}
        // A demonstration shop or network is named as one, so a real feed is not attached to it by mistake.
        shops={shops.map((shop) => ({
          value: String(shop.id),
          label: shop.demo ? t('demoOptionShop', { shop: shop.name }) : shop.name,
        }))}
        networks={networks.map((network) => ({
          value: String(network.id),
          label: network.demo ? t('demoOptionNetwork', { network: network.name }) : network.name,
        }))}
        defaultShopId={defaultShopId}
        addNetwork={{ href: `${SOURCES_PATH}/red/nueva`, label: sources('addNetwork') }}
        labels={feedFormLabels(t, {
          mode: 'create',
          feedId: 0,
          demo: false,
          limits: {
            name: NAME_MAX,
            slug: SLUG_MAX,
            address: FEED_URL_MAX,
            fileName: CATALOGUE_FILE_NAME_MAX,
            fileKinds: fileKindsText(CATALOGUE_FILE_KINDS),
          },
        })}
      />
    </FormScreen>
  );
}
