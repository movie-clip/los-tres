import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AdminMessage } from '@/components/admin/AdminMessage';
import { getSiteName } from '@/config/site';

// Next ignores a page's generateMetadata once the page throws notFound(), so the 404 tab
// title is set here, on the boundary every not-found in the shell renders through.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin.Meta');
  return { title: t('notFoundTitle', { siteName: getSiteName() }) };
}

// For notFound() called inside a guarded admin page, so it renders within the
// shell header and menu. An unmatched /admin/* URL reaches it through the
// catch-all page [...rest]/page.tsx, which checks the role first.
export default async function AdminNotFound() {
  const t = await getTranslations('Admin.NotFound');
  return (
    <AdminMessage
      heading={t('heading')}
      body={t('body')}
      link={{ href: '/admin', label: t('backHome') }}
    />
  );
}
