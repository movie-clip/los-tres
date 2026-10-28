import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotFoundContent } from '@/components/NotFoundContent';
import { getSiteName } from '@/config/site';

import { PublicChrome } from './PublicChrome';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('NotFound');
  return { title: t('metaTitle', { siteName: getSiteName() }) };
}

// Outside (public)/layout.tsx, so it renders the public chrome itself. Every
// unmatched top-level URL, /admin/* included, ends here (the ordinary public
// 404). A notFound() raised inside (public) ends in (public)/not-found.tsx,
// which sets its title differently (see there).
export default function NotFound() {
  return (
    <PublicChrome>
      <NotFoundContent />
    </PublicChrome>
  );
}
