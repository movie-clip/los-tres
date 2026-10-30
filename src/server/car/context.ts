import 'server-only';

import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { errorCode } from '../error-code';
import { CAR_HEADER, PATH_HEADER, readForwardedCar, readForwardedPath } from './request';
import type { CarContext } from './state';
import { readActiveVehicles, type ActiveVehicle } from './vehicles';

// The selected car of this request (S5.7, C2). The only reader of the two request
// headers src/proxy.ts sets: no page reads `searchParams.coche`. Nothing is stored
// and nothing about the car or the path is logged (guardrail 5): a failed vehicle
// read logs one fixed line with an error code.

export { openedWithCoche, selectedSlug } from './state';
export type { CarContext, SelectedVehicle } from './state';

/**
 * The car for this request, once per request. `none` without a `coche`; for a
 * `coche`, `selected` when it names an active vehicle, `unrecognised` when it does
 * not (unknown, retired, malformed, empty or repeated); `unavailable` when the
 * vehicle list cannot be read.
 */
export const getCarContext = cache(async (): Promise<CarContext> => {
  const incoming = await headers();
  const path = readForwardedPath(incoming.get(PATH_HEADER));
  const forwarded = readForwardedCar(incoming.get(CAR_HEADER));

  if (forwarded.kind === 'none') return { state: 'none', path };
  if (forwarded.kind === 'invalid') return { state: 'unrecognised', raw: null, path };

  let found: ActiveVehicle | undefined;
  try {
    found = (await readActiveVehicles()).find((vehicle) => vehicle.slug === forwarded.slug);
  } catch (error) {
    console.error(
      `car: vehicles failed (${errorCode(error instanceof Error && error.cause !== undefined ? error.cause : error)})`,
    );
    return { state: 'unavailable', path };
  }
  if (found === undefined) return { state: 'unrecognised', raw: forwarded.slug, path };

  const t = await getTranslations('Car');
  return {
    state: 'selected',
    vehicle: {
      id: found.id,
      slug: found.slug,
      makeSlug: found.makeSlug,
      modelSlug: found.modelSlug,
      name: t('name', {
        make: found.make,
        model: found.model,
        generation: found.generation,
        engine: found.engine,
      }),
    },
    path,
  };
});
