import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { getOwnerIdentity } from '@/config/owner';
import { getSiteName } from '@/config/site';

import { LegalNoticeContent } from './content';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('LegalNotice');
  return { title: t('metaTitle', { siteName: getSiteName() }) };
}

export default async function LegalNoticePage() {
  const t = await getTranslations('LegalNotice');
  // Throws, and the page answers 500, when a required owner value is blank.
  const owner = getOwnerIdentity();
  return (
    <main className="page">
      <LegalNoticeContent t={t} siteName={getSiteName()} owner={owner} />
    </main>
  );
}
