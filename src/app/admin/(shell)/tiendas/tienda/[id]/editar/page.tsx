import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { FormScreen } from '@/components/admin/FormScreen';
import { NameSlugForm } from '@/components/admin/NameSlugForm';
import { nameSlugFormLabels } from '@/components/admin/source-form-labels';
import { getSiteName } from '@/config/site';
import { FEED_URL_MAX, NAME_MAX, SLUG_MAX, parseId } from '@/server/admin/source-rules';
import { getShopForEdit } from '@/server/admin/sources';
import { requireAdminPage } from '@/server/auth/guard';

import { updateShopAction } from '../../../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('editShopTitle', { siteName: getSiteName() }) };
}

export default async function EditShopPage({ params }: { params: Promise<{ id: string }> }) {
  // The role check first, then the id: an anonymous request is redirected before `params` is read.
  await requireAdminPage();
  const id = parseId((await params).id);
  if (id === null) notFound();
  const shop = await getShopForEdit(id);
  if (!shop) notFound();

  const t = await getTranslations('Admin.Form');
  return (
    <FormScreen
      back={{ href: '/admin/tiendas', label: t('backLink') }}
      heading={t('Shop.headingEdit')}
      intro={t('Shop.introEdit')}
    >
      <NameSlugForm
        action={updateShopAction}
        id={shop.id}
        defaults={{ name: shop.name, slug: shop.slug }}
        cancelHref="/admin/tiendas"
        labels={nameSlugFormLabels(t, 'shop', 'edit', { name: NAME_MAX, slug: SLUG_MAX, address: FEED_URL_MAX })}
      />
    </FormScreen>
  );
}
