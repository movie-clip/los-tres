'use client';

import { AdminHeader } from '@/components/admin/AdminHeader';
import { useAdminFallback } from '@/components/admin/AdminFallbackContext';
import { AdminMessage } from '@/components/admin/AdminMessage';

/**
 * Any failure rendering an admin page is answered with the Unavailable screen:
 * the brand-only header and a way to try again. A production error boundary
 * cannot tell AdminUnavailableError from another error, and nothing from the
 * admin area is shown either way. The retry is a plain anchor, so it is a full
 * navigation and the guard runs again.
 */
export default function AdminError() {
  const fallback = useAdminFallback();
  if (!fallback) return null;
  return (
    <>
      <AdminHeader siteName={fallback.siteName} areaLabel={fallback.areaLabel} />
      <AdminMessage
        heading={fallback.heading}
        body={fallback.body}
        link={{ href: '/admin', label: fallback.retry }}
      />
    </>
  );
}
