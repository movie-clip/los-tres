import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { FormScreen } from '@/components/admin/FormScreen';
import { NameSlugForm } from '@/components/admin/NameSlugForm';
import { nameSlugFormLabels } from '@/components/admin/source-form-labels';
import { getSiteName } from '@/config/site';
import { FEED_URL_MAX, NAME_MAX, SLUG_MAX, parseId } from '@/server/admin/source-rules';
import { getNetworkForEdit } from '@/server/admin/sources';
import { requireAdminPage } from '@/server/auth/guard';

import { updateNetworkAction } from '../../../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('editNetworkTitle', { siteName: getSiteName() }) };
}

export default async function EditNetworkPage({ params }: { params: Promise<{ id: string }> }) {
  // The role check first, then the id: an anonymous request is redirected before `params` is read.
  await requireAdminPage();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const network = await getNetworkForEdit(id);
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
