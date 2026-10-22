import { notFound } from 'next/navigation';

import { requireAdminPage } from '@/server/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Catch-all for an unmatched /admin/* URL. The role check comes first
 * (guardrail 3): an anonymous request is redirected to sign-in exactly as for
 * any other admin URL, so no admin path is told apart from another. Only a
 * signed-in admin reaches notFound(), which renders (shell)/not-found.tsx inside
 * the shell layout, with the admin header and menu, and answers 404.
 *
 * It exports no generateMetadata on purpose: it reads no data, and the admin
 * layout supplies the noindex title.
 */
export default async function AdminUnmatchedPage() {
  await requireAdminPage();
  notFound();
}
