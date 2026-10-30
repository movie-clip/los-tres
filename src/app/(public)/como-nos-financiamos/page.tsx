import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CarNotice } from '@/components/CarNotice';
import { getSiteName } from '@/config/site';
import { getCarContext } from '@/server/car/context';
import { noindexWhenCar } from '@/server/catalogue/seo';

import { FundingContent } from './content';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [t, car] = await Promise.all([getTranslations('Funding'), getCarContext()]);
  return { title: t('metaTitle', { siteName: getSiteName() }), ...noindexWhenCar(car) };
}

export default async function FundingPage() {
  const [t, tCar, car] = await Promise.all([
    getTranslations('Funding'),
    getTranslations('Car'),
    getCarContext(),
  ]);
  return (
    <main className="page">
      {car.state === 'unrecognised' && <CarNotice text={tCar('unknownNotice')} />}
      <FundingContent t={t} siteName={getSiteName()} />
    </main>
  );
}
