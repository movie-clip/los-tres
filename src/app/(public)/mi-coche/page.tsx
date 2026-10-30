import type { Metadata } from 'next';
import { RedirectType, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CarPickerStep, type CarPickerCurrent } from '@/components/CarPickerStep';
import { getPublicOrigin, getSiteName } from '@/config/site';
import { getPickerLabels, getPickerOptions } from '@/app/PublicChrome';
import { resolvePickerStep, type PickerMake, type PickerQuery } from '@/server/car/picker';
import { pageSeo } from '@/server/catalogue/seo';

import styles from './page.module.css';
import { StoreOnPick } from './StoreOnPick';

export const dynamic = 'force-dynamic';

const PICKER_PATH = '/mi-coche';

type CarPickerPageProps = { searchParams: Promise<PickerQuery> };

// The picker page is for visitors without script, and for the final press with it: never
// indexed, no canonical, whatever the query.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('CarPicker');
  return {
    title: t('metaTitle', { siteName: getSiteName() }),
    ...pageSeo(getPublicOrigin(), PICKER_PATH, false),
  };
}

/**
 * The car the visitor came here with, for marking its rows: the `coche` of the page
 * to return to (the header links carry the current car there). A lookup in the tree,
 * nothing else; null when there is none or it is not in the tree.
 */
function currentFromReturn(
  returnTo: string | null,
  options: readonly PickerMake[],
): CarPickerCurrent | null {
  if (returnTo === null) return null;
  const slug = new URL(returnTo, 'http://h.invalid').searchParams.get('coche');
  if (slug === null) return null;
  for (const make of options) {
    for (const model of make.models) {
      if (model.engines.some((engine) => engine.slug === slug)) {
        return { makeSlug: make.slug, modelSlug: model.slug, slug };
      }
    }
  }
  return null;
}

export default async function CarPickerPage({ searchParams }: CarPickerPageProps) {
  const query = await searchParams;
  const [t, options, labels] = await Promise.all([
    getTranslations('CarPicker'),
    getPickerOptions(),
    getPickerLabels(),
  ]);

  const resolved = resolvePickerStep(query, options, null);
  // All three choices are consistent: back to the page the visitor came from, car set.
  if (resolved.step === 'done') redirect(resolved.location, RedirectType.replace);

  const { returnTo } = resolved;
  const volver = returnTo === null ? '' : `volver=${encodeURIComponent(returnTo)}`;
  const toMakes = volver === '' ? PICKER_PATH : `${PICKER_PATH}?${volver}`;
  const toModels =
    resolved.step === 'make'
      ? toMakes
      : `${PICKER_PATH}?marca=${encodeURIComponent(resolved.make.slug)}${volver === '' ? '' : `&${volver}`}`;

  const stepNumber = resolved.step === 'make' ? 1 : resolved.step === 'model' ? 2 : 3;

  return (
    <main className="page">
      <h1 className={styles.title}>{t('title')}</h1>
      <div className={styles.card} data-testid="car-picker-page">
        <StoreOnPick>
          <CarPickerStep
            step={stepNumber}
            options={options}
            make={resolved.step === 'make' ? null : resolved.make}
            model={resolved.step === 'engine' ? resolved.model : null}
            current={currentFromReturn(returnTo, options)}
            labels={labels}
            headingLevel={2}
            headingId="car-picker-prompt"
            backHref={resolved.step === 'model' ? toMakes : toModels}
            returnTo={returnTo}
            action={PICKER_PATH}
          />
        </StoreOnPick>
      </div>
      <a href={returnTo ?? '/'} className={styles.cancel} data-testid="car-picker-cancel">
        {t('cancel')}
      </a>
    </main>
  );
}
