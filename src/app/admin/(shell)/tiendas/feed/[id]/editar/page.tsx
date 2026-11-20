import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { FeedForm } from '@/components/admin/FeedForm';
import { FormScreen } from '@/components/admin/FormScreen';
import { feedFormLabels } from '@/components/admin/source-form-labels';
import { getSiteName } from '@/config/site';
import { FEED_URL_MAX, NAME_MAX, SLUG_MAX, parseId } from '@/server/admin/source-rules';
import { getFeedForEdit, listNetworksForAdmin } from '@/server/admin/sources';
import { requireAdminPage } from '@/server/auth/guard';

import { updateFeedAction } from '../../../actions';

export const dynamic = 'force-dynamic';

const SOURCES_PATH = '/admin/tiendas';

// One lookup per request, shared by `generateMetadata` and the page. A catalogue-file feed
// is a 404 here until its own edit screen replaces this narrowing (S3.7).
const load = cache(async (id: number) => {
  const feed = await getFeedForEdit(id);
  return feed?.source === 'affiliate_network' ? feed : null;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  const siteName = getSiteName();
  // The production build keeps the page's own title when the page throws notFound(), so the
  // not-found title is decided here: an id that does not parse, or has no row, is the 404.
  const id = parseId((await params).id);
  if (id === null || !(await load(id))) return { title: t('notFoundTitle', { siteName }) };
  return { title: t('editFeedTitle', { siteName }) };
}

export default async function EditFeedPage({ params }: { params: Promise<{ id: string }> }) {
  // The role check first, then the id: an anonymous request is redirected before `params` is read.
  await requireAdminPage();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [feed, networks] = await Promise.all([load(id), listNetworksForAdmin()]);
  if (!feed) notFound();

  const [t, sources] = await Promise.all([getTranslations('Admin.Form'), getTranslations('Admin.Sources')]);
  // The host, or a fixed phrase: the stored address is never a fallback (AC 24).
  const domain = feed.host ?? (feed.demo ? sources('domainNone') : sources('domainUnavailable'));

  return (
    <FormScreen
      back={{ href: SOURCES_PATH, label: t('backLink') }}
      heading={t('Feed.headingEdit', { id: feed.id })}
      intro={t('Feed.introEdit')}
    >
      <FeedForm
        mode="edit"
        action={updateFeedAction}
        cancelHref={SOURCES_PATH}
        id={feed.id}
        shopName={feed.shopName}
        networks={networks.map((network) => ({
          value: String(network.id),
          label: network.demo ? t('demoOptionNetwork', { network: network.name }) : network.name,
        }))}
        defaultNetworkId={String(feed.networkId)}
        approved={feed.approved}
        demo={feed.demo}
        domain={domain}
        labels={feedFormLabels(t, {
          mode: 'edit',
          feedId: feed.id,
          demo: feed.demo,
          limits: { name: NAME_MAX, slug: SLUG_MAX, address: FEED_URL_MAX },
        })}
      />
    </FormScreen>
  );
}
