import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotFoundContent } from '@/components/NotFoundContent';
import { getSiteName } from '@/config/site';

// The served head carries this title for a crawler or a visitor without script.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('NotFound');
  return { title: t('metaTitle', { siteName: getSiteName() }) };
}

// A notFound() raised inside (public): the layout already draws the chrome,
// so only the content renders here. Unmatched top-level URLs use the root file.
//
// The title element is for the browser: the client renders a nested 404 from
// the flight payload, which carries the layout's default title and not this
// file's metadata, so the tab would show the default. React hoists the element.
export default async function PublicNotFound() {
  const t = await getTranslations('NotFound');
  return (
    <>
      <title>{t('metaTitle', { siteName: getSiteName() })}</title>
      <NotFoundContent />
    </>
  );
}
