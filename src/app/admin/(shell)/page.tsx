import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AdminMessage } from '@/components/admin/AdminMessage';
import { getSiteName } from '@/config/site';
import { requireAdminPage } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Next resolves metadata before the page body, so this is a server entry point of
  // an admin route: the role check comes first (guardrail 3). Cached per request.
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('homeTitle', { siteName: getSiteName() }) };
}

export default async function AdminHomePage() {
  // The role check of this page (guardrail 3); the layout also checks, once per request.
  await requireAdminPage();
  const t = await getTranslations('Admin.Home');
  return <AdminMessage heading={t('heading')} body={t('emptyBody')} />;
}
