import { getTranslations } from 'next-intl/server';

import { AdminMessage } from '@/components/admin/AdminMessage';

// For notFound() called inside a guarded admin page, so it renders within the
// shell header and menu. An unmatched /admin/* URL never reaches here: it gets
// the public 404 (src/app/not-found.tsx).
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
