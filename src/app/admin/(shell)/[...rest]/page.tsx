import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getSiteName } from '@/config/site';
import { requireAdminPage } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Catch-all for an unmatched /admin/* URL. The role check comes first
 * (guardrail 3): an anonymous request is redirected to sign-in exactly as for
 * any other admin URL, so no admin path is told apart from another. Only a
 * signed-in admin reaches notFound(), which renders (shell)/not-found.tsx inside
 * the shell layout, with the admin header and menu, and answers 404.
 *
 * Its generateMetadata only names the not-found tab title, after the same role
 * check; it reads no data. The production build keeps the page's own metadata on
 * a thrown notFound() and ignores the boundary's, so the title is set here too.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdminPage();
  const t = await getTranslations('Admin.Meta');
  return { title: t('notFoundTitle', { siteName: getSiteName() }) };
}

export default async function AdminUnmatchedPage() {
  await requireAdminPage();
  notFound();
}
