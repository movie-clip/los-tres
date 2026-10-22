import { createElement } from 'react';

import { requireAdminPage } from '@/server/auth/guard';

// A deliberately half-guarded admin page: the body asks who is calling, but
// generateMetadata reads without asking (the CR-1 defect). The AC 22 enumerator
// must report `admin/leak-meta/page.tsx#generateMetadata`. Not part of the app.
export async function generateMetadata() {
  return { title: 'admin secret title' };
}

export default async function HalfGuardedPage() {
  await requireAdminPage();
  return createElement('main', null, 'admin');
}
