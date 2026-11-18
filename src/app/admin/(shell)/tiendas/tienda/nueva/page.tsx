import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FormScreen } from '@/components/admin/FormScreen';
import { NameSlugForm } from '@/components/admin/NameSlugForm';
import { nameSlugFormLabels } from '@/components/admin/source-form-labels';
import { getSiteName } from '@/config/site';
import { FEED_URL_MAX, NAME_MAX, SLUG_MAX } from '@/server/admin/source-rules';
import { requireAdminPage } from '@/server/auth/guard';

import { createShopAction } from '../../actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // A server entry point of an admin route: the role check comes first (guardrail 3).
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('newShopTitle', { siteName: getSiteName() }) };
}

export default async function NewShopPage() {
  await requireAdminPage();
  const t = await getTranslations('Admin.Form');
  return (
    <FormScreen
      back={{ href: '/admin/tiendas', label: t('backLink') }}
      heading={t('Shop.headingNew')}
      intro={t('Shop.introNew')}
    >
      <NameSlugForm
        action={createShopAction}
        defaults={{ name: '', slug: '' }}
        cancelHref="/admin/tiendas"
        labels={nameSlugFormLabels(t, 'shop', 'create', { name: NAME_MAX, slug: SLUG_MAX, address: FEED_URL_MAX })}
      />
    </FormScreen>
  );
}
