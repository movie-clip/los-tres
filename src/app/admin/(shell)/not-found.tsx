import { getTranslations } from 'next-intl/server';

import { AdminMessage } from '@/components/admin/AdminMessage';

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
