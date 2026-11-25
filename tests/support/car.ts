import { expect, type Page } from '@playwright/test';

import messages from '../../messages/es-ES.json';
import { VEHICLE_CATALOGUE, type VehicleEntry } from '../../src/db/vehicle-catalogue';
import { icuPlural } from './messages';

// Shared scaffolding for the S5.7 car-selection e2e (car-*.spec.ts). Vehicles come from the
// shipped list, never retyped; copy comes from messages/es-ES.json, never a literal. The one
// literal is the storage key: the key is the contract (D-21), so a rename must fail a test.

/** The browser storage key (D-21, AC 31). Pinned on purpose. */
export const CAR_STORAGE_KEY = 'mi-coche';

/** The finished car name the header shows: Car.name over make, model, generation, engine. */
export function carName(entry: VehicleEntry): string {
  return messages.Car.name
    .replace('{make}', entry.make)
    .replace('{model}', entry.model)
    .replace('{generation}', entry.generation)
    .replace('{engine}', entry.engine);
}

const bySlug = (slug: string): VehicleEntry => {
  const entry = VEHICLE_CATALOGUE.find((item) => item.slug === slug);
  if (entry === undefined) throw new Error(`the vehicle list has no ${slug}`);
  return entry;
};

/** Seat León III 1.6 TDI: the first vehicle of the list. */
export const CAR = VEHICLE_CATALOGUE[0];
/** A car of another make. */
export const OTHER_MAKE = bySlug('volkswagen-golf-vii-2012-2020-1-6-tdi-110cv');
/** Slug-shaped, but no vehicle (and, like a retired one, not an active one). */
export const UNKNOWN_SLUG = 'coche-que-no-existe';

/** The makes of the list in list order: label and slug (AC 8, 12). */
export function makesOf(): { slug: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const entry of VEHICLE_CATALOGUE) if (!seen.has(entry.makeSlug)) seen.set(entry.makeSlug, entry.make);
  return [...seen].map(([slug, label]) => ({ slug, label }));
}

/** The model generations of a make in list order: slug and the "León III" label (AC 9). */
export function modelsOf(makeSlug: string): { slug: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const entry of VEHICLE_CATALOGUE) {
    if (entry.makeSlug === makeSlug && !seen.has(entry.modelSlug)) {
      seen.set(entry.modelSlug, `${entry.model} ${entry.generation}`);
    }
  }
  return [...seen].map(([slug, label]) => ({ slug, label }));
}

/** The engines of a model generation in list order (AC 10). */
export function enginesOf(modelSlug: string): VehicleEntry[] {
  return VEHICLE_CATALOGUE.filter((entry) => entry.modelSlug === modelSlug);
}

/** "Diésel · 115 CV": the second line of an engine row. */
export function engineDetail(entry: VehicleEntry): string {
  const fuel = messages.CarPicker.fuel[entry.fuel];
  return messages.CarPicker.engineDetail.replace('{fuel}', fuel).replace('{power}', String(entry.powerCv));
}

/** The `Mi coche: <name>` text the label shows (the message's `<name>` tag is a `strong`). */
export function selectedText(entry: VehicleEntry): string {
  return `Mi coche: ${carName(entry)}`;
}

/** The vehicle whose finished "Mi coche: ..." label is the longest of the list (first on a tie). */
export const LONGEST_CAR: VehicleEntry = VEHICLE_CATALOGUE.reduce((longest, entry) =>
  selectedText(entry).length > selectedText(longest).length ? entry : longest,
);

/**
 * S5.8: the counts line a listing shows with a selected car, built from the message file: fits, no
 * data and hidden joined by a middle dot, then the page indicator when there are several pages.
 * `paged` is `[page, pages]`; `exact` is the search-only fourth part (#277).
 */
export function fitCountsLine(
  counts: { fits: number; unknown: number; leftOut: number; exact?: number },
  paged?: [number, number],
): string {
  const plural = (message: string, count: number): string => icuPlural(message, count);
  return [
    plural(messages.Fit.countFits, counts.fits),
    messages.Fit.countUnknown.replace('{count}', String(counts.unknown)),
    plural(messages.Fit.countLeftOut, counts.leftOut),
    ...(counts.exact === undefined || counts.exact === 0 ? [] : [plural(messages.Fit.countExact, counts.exact)]),
    ...(paged === undefined
      ? []
      : [messages.Category.pageIndicator.replace('{page}', String(paged[0])).replace('{pages}', String(paged[1]))]),
  ].join(' · ');
}

/** The query string of a URL without the leading `?`, as an ordered list of [name, value]. */
export function queryOf(url: string): [string, string][] {
  return [...new URL(url, 'http://h.invalid').searchParams.entries()];
}

export function cocheValues(url: string): string[] {
  return new URL(url, 'http://h.invalid').searchParams.getAll('coche');
}

/**
 * Waits until the control's actions are buttons (script has hydrated the component): a press
 * before that follows the no-script link and leaves the page.
 */
export async function scriptedControl(page: Page, selected: boolean): Promise<void> {
  await expect(page.getByTestId(selected ? 'car-change' : 'car-select')).toHaveAttribute(
    'aria-haspopup',
    'dialog',
  );
}

/** The localStorage entries of the page's origin as a plain object. */
export function storageOf(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) as string;
      out[key] = window.localStorage.getItem(key) as string;
    }
    return out;
  });
}
