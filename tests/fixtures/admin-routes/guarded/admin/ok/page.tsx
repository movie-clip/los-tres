import { createElement } from 'react';

import { requireAdminPage } from '@/server/auth/guard';

// A guarded admin page: the shape every admin page must have.
export default async function GuardedPage() {
  await requireAdminPage();
  return createElement('main', null, 'admin');
}
