import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { getOwnerIdentity } from '@/config/owner';
import { getSiteName } from '@/config/site';

import { PrivacyContent } from './content';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Privacy');
  return { title: t('metaTitle', { siteName: getSiteName() }) };
}

export default async function PrivacyPage() {
  const t = await getTranslations('Privacy');
  // Throws, and the page answers 500, when a required owner value is blank.
  const owner = getOwnerIdentity();
  return (
    <main className="page">
      <PrivacyContent t={t} siteName={getSiteName()} owner={owner} />
    </main>
  );
}
