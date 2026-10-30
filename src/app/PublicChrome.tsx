import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import type { CarControlProps, CarStrings } from '@/components/CarControl';
import { PublicFallbackProvider } from '@/components/PublicFallbackContext';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getSiteName } from '@/config/site';
import { getCarContext, openedWithCoche } from '@/server/car/context';
import { buildPickerOptions, type PickerFormat, type PickerMake } from '@/server/car/picker';
import { carLinks } from '@/server/car/return-path';
import { readActiveVehicles } from '@/server/car/vehicles';
import { SEARCH_PATH } from '@/server/catalogue/paths';
import { errorCode } from '@/server/error-code';

const PICKER_PATH = '/mi-coche';

/**
 * The picker tree (makes, models, engines) with its display strings finished, once per
 * request: the chrome embeds it for the dialog and the /mi-coche page renders its steps
 * from it. A failed vehicle read gives an empty tree (the picker says there is no car
 * to choose) and logs one fixed line with an error code, never the car or the path.
 */
export const getPickerOptions = cache(async (): Promise<PickerMake[]> => {
  const t = await getTranslations('CarPicker');
  const format: PickerFormat = {
    modelHeading: (make) => t('modelHeading', { make }),
    engineHeading: (model) => t('engineHeading', { model }),
    years: (from, to) => t('years', { from, to }),
    yearsOngoing: (from) => t('yearsOngoing', { from }),
    engineDetail: (fuel, power) => t('engineDetail', { fuel: t(`fuel.${fuel}`), power }),
  };
  try {
    return buildPickerOptions(await readActiveVehicles(), format);
  } catch (error) {
    console.error(
      `car: vehicles failed (${errorCode(error instanceof Error && error.cause !== undefined ? error.cause : error)})`,
    );
    return [];
  }
});

/** The labels every step of the picker needs, finished: shared by the dialog and the page. */
export async function getPickerLabels(): Promise<CarStrings['dialog']['picker']> {
  const t = await getTranslations('CarPicker');
  return {
    counters: [
      t('stepCounter', { step: 1, total: 3 }),
      t('stepCounter', { step: 2, total: 3 }),
      t('stepCounter', { step: 3, total: 3 }),
    ],
    makeHeading: t('makeHeading'),
    backToMakes: t('backToMakes'),
    backToModels: t('backToModels'),
    empty: t('empty'),
  };
}

/**
 * The public header and footer around a page. Shared by (public)/layout.tsx and
 * the root not-found.tsx, which sits outside that layout. Also hands the public
 * error boundary its finished strings. Not a route file.
 */
export async function PublicChrome({ children }: { children: React.ReactNode }) {
  const [t, tError, tNotFound, tSearch, tCar, tPicker, car, options, pickerLabels] =
    await Promise.all([
      getTranslations('Footer'),
      getTranslations('Error'),
      getTranslations('NotFound'),
      getTranslations('Search'),
      getTranslations('Car'),
      getTranslations('CarPicker'),
      getCarContext(),
      getPickerOptions(),
      getPickerLabels(),
    ]);
  // The car control of header row 2. The picker page is the picker itself, so it has none.
  const onPickerPage = car.path !== null && car.path.split('?')[0] === PICKER_PATH;
  const carControl: CarControlProps | null = onPickerPage
    ? null
    : {
        car:
          car.state === 'selected'
            ? {
                slug: car.vehicle.slug,
                makeSlug: car.vehicle.makeSlug,
                modelSlug: car.vehicle.modelSlug,
                name: car.vehicle.name,
              }
            : null,
        unrecognised: car.state === 'unrecognised' ? car.raw : null,
        cochePresent: openedWithCoche(car),
        options,
        links: carLinks(car),
        strings: {
          groupLabel: tCar('groupLabel'),
          select: tCar('select'),
          selected:
            car.state === 'selected'
              ? tCar.rich('selected', {
                  car: car.vehicle.name,
                  name: (chunks) => <strong>{chunks}</strong>,
                })
              : null,
          change: tCar('change'),
          changeLabel: tCar('changeLabel'),
          remove: tCar('remove'),
          removeLabel: tCar('removeLabel'),
          dialog: {
            title: tPicker('title'),
            close: tPicker('close'),
            closeLabel: tPicker('closeLabel'),
            picker: pickerLabels,
          },
        },
      };
  // The three legal pages, in the owner's order. Plain paths, no configuration.
  const footerLinks = [
    { href: '/aviso-legal', label: t('legalNotice') },
    { href: '/privacidad', label: t('privacy') },
    { href: '/como-nos-financiamos', label: t('funding') },
  ];
  return (
    <PublicFallbackProvider
      value={{ heading: tError('heading'), body: tError('body'), home: tNotFound('backHome') }}
    >
      <SiteHeader
        siteName={getSiteName()}
        search={{
          variant: 'header',
          action: SEARCH_PATH,
          formLabel: tSearch('formLabel'),
          fieldLabel: tSearch('fieldLabel'),
          button: tSearch('button'),
          hint: null,
          value: null,
        }}
        car={carControl}
      />
      {children}
      <SiteFooter links={footerLinks} />
    </PublicFallbackProvider>
  );
}
