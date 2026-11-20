import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { FormScreen } from '@/components/admin/FormScreen';
import { NameSlugForm } from '@/components/admin/NameSlugForm';
import { nameSlugFormLabels } from '@/components/admin/source-form-labels';
import { getSiteName } from '@/config/site';
import { FEED_URL_MAX, NAME_MAX, SLUG_MAX, parseId } from '@/server/admin/source-rules';
import { getNetworkForEdit } from '@/server/admin/sources';
import { requireAdminPage } from '@/server/auth/guard';

import { updateNetworkAction } from '../../../actions';

export const dynamic = 'force-dynamic';

// One lookup per request, shared by `generateMetadata` and the page.
const load = cache((id: number) => getNetworkForEdit(id));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  const siteName = getSiteName();
  // The production build keeps the page's own title when the page throws notFound(), so the
  // not-found title is decided here: an id that does not parse, or has no row, is the 404.
  const id = parseId((await params).id);
  if (id === null || !(await load(id))) return { title: t('notFoundTitle', { siteName }) };
  return { title: t('editNetworkTitle', { siteName }) };
}

export default async function EditNetworkPage({ params }: { params: Promise<{ id: string }> }) {
  // The role check first, then the id: an anonymous request is redirected before `params` is read.
  await requireAdminPage();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const network = await load(id);
  if (!network) notFound();

  const t = await getTranslations('Admin.Form');
  return (
    <FormScreen
      back={{ href: '/admin/tiendas', label: t('backLink') }}
      heading={t('Network.headingEdit')}
      intro={t('Network.introEdit')}
    >
      <NameSlugForm
        action={updateNetworkAction}
        id={network.id}
        defaults={{ name: network.name, slug: network.slug }}
        cancelHref="/admin/tiendas"
        labels={nameSlugFormLabels(t, 'network', 'edit', { name: NAME_MAX, slug: SLUG_MAX, address: FEED_URL_MAX })}
      />
    </FormScreen>
  );
}
