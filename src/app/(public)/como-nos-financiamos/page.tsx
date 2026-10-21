import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { getSiteName } from '@/config/site';

import { FundingContent } from './content';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Funding');
  return { title: t('metaTitle', { siteName: getSiteName() }) };
}

export default async function FundingPage() {
  const t = await getTranslations('Funding');
  return (
    <main className="page">
      <FundingContent t={t} siteName={getSiteName()} />
    </main>
  );
}
