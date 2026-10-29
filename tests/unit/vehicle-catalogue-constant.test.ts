import { describe, expect, it } from 'vitest';

import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FUELS = ['gasolina', 'diesel', 'hibrido', 'electrico', 'glp'];
const REQUIRED_MAKE_SLUGS = [
  'seat',
  'volkswagen',
  'renault',
  'peugeot',
  'citroen',
  'toyota',
  'dacia',
  'ford',
  'opel',
  'kia',
  'hyundai',
];

// Vehicle slugs are frozen identifiers (decision 0016): fitments point at them
// and nothing redirects a renamed one. Changing the list's slugs must fail this
// test on purpose (S5.5, AC 8).
describe('VEHICLE_CATALOGUE (S5.5)', () => {
  it('holds between 30 and 60 vehicles (AC 1)', () => {
    expect(VEHICLE_CATALOGUE.length).toBeGreaterThanOrEqual(30);
    expect(VEHICLE_CATALOGUE.length).toBeLessThanOrEqual(60);
  });

  it('has at least one vehicle for each of the eleven required makes (AC 2)', () => {
    const makeSlugs = new Set(VEHICLE_CATALOGUE.map((entry) => entry.makeSlug));
    for (const makeSlug of REQUIRED_MAKE_SLUGS) expect(makeSlugs.has(makeSlug), makeSlug).toBe(true);
  });

  it('gives every vehicle all the required fields, with an optional engine code and end year (AC 3, 9)', () => {
    for (const entry of VEHICLE_CATALOGUE) {
      for (const key of ['slug', 'make', 'makeSlug', 'model', 'modelSlug', 'generation', 'engine'] as const) {
        expect(typeof entry[key], `${entry.slug}.${key}`).toBe('string');
        expect(entry[key].trim(), `${entry.slug}.${key}`).not.toBe('');
      }
      for (const key of ['yearFrom', 'powerKw', 'powerCv', 'position'] as const) {
        expect(Number.isInteger(entry[key]), `${entry.slug}.${key}`).toBe(true);
      }
      expect(entry.powerKw, entry.slug).toBeGreaterThan(0);
      expect(entry.powerCv, entry.slug).toBeGreaterThan(0);
      // Optional fields are null, never an empty string or undefined.
      expect(entry.engineCode === null || entry.engineCode.trim() !== '', entry.slug).toBe(true);
      expect(entry.yearTo === null || Number.isInteger(entry.yearTo), entry.slug).toBe(true);
    }
  });

  it('accepts both a generation still on sale and a finished one (AC 9)', () => {
    expect(VEHICLE_CATALOGUE.some((entry) => entry.yearTo === null)).toBe(true);
    expect(VEHICLE_CATALOGUE.some((entry) => entry.yearTo !== null)).toBe(true);
  });

  it('never ends a vehicle before it starts (AC 9)', () => {
    for (const entry of VEHICLE_CATALOGUE) {
      if (entry.yearTo !== null) expect(entry.yearTo, entry.slug).toBeGreaterThanOrEqual(entry.yearFrom);
    }
  });

  it('uses only the five fuel codes (AC 4)', () => {
    for (const entry of VEHICLE_CATALOGUE) expect(FUELS, entry.slug).toContain(entry.fuel);
  });

  it('has lowercase-ASCII hyphen slugs for vehicles, makes and models (AC 5)', () => {
    for (const entry of VEHICLE_CATALOGUE) {
      expect(entry.slug).toMatch(SLUG_FORMAT);
      expect(entry.makeSlug).toMatch(SLUG_FORMAT);
      expect(entry.modelSlug).toMatch(SLUG_FORMAT);
    }
  });

  it('has no two vehicles with the same slug (AC 5; the upsert would not notice a duplicate)', () => {
    const slugs = VEHICLE_CATALOGUE.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives one make slug to each make name and one make name to each make slug (AC 5)', () => {
    const slugByMake = new Map<string, Set<string>>();
    const makeBySlug = new Map<string, Set<string>>();
    for (const entry of VEHICLE_CATALOGUE) {
      slugByMake.set(entry.make, (slugByMake.get(entry.make) ?? new Set()).add(entry.makeSlug));
      makeBySlug.set(entry.makeSlug, (makeBySlug.get(entry.makeSlug) ?? new Set()).add(entry.make));
    }
    for (const [make, slugs] of slugByMake) expect([...slugs], make).toHaveLength(1);
    for (const [slug, makes] of makeBySlug) expect([...makes], slug).toHaveLength(1);
  });

  it('starts every vehicle slug and model slug with its make slug', () => {
    for (const entry of VEHICLE_CATALOGUE) {
      expect(entry.slug.startsWith(`${entry.makeSlug}-`), entry.slug).toBe(true);
      expect(entry.modelSlug.startsWith(`${entry.makeSlug}-`), entry.modelSlug).toBe(true);
    }
  });

  it('keeps one model, generation and make together under each model slug (picker grouping)', () => {
    const groups = new Map<string, Set<string>>();
    for (const entry of VEHICLE_CATALOGUE) {
      const identity = [entry.make, entry.model, entry.generation].join('|');
      groups.set(entry.modelSlug, (groups.get(entry.modelSlug) ?? new Set()).add(identity));
    }
    expect(groups.size).toBeGreaterThan(0);
    for (const [modelSlug, identities] of groups) expect([...identities], modelSlug).toHaveLength(1);
  });

  it('has unique positions that increase in list order (AC 6)', () => {
    const positions = VEHICLE_CATALOGUE.map((entry) => entry.position);
    expect(new Set(positions).size).toBe(positions.length);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i], VEHICLE_CATALOGUE[i].slug).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('is exactly this set of slugs, in this order (AC 8)', () => {
    expect(VEHICLE_CATALOGUE.map((entry) => entry.slug)).toEqual([
    'seat-leon-iii-2012-2020-1-6-tdi-115cv',
    'seat-leon-iii-2012-2020-1-4-tsi-125cv',
    'seat-ibiza-iv-2008-2017-1-2-tsi-90cv',
    'seat-ibiza-v-2017-1-0-tsi-95cv',
    'seat-arona-i-2017-1-0-tsi-110cv',
    'volkswagen-golf-vii-2012-2020-1-6-tdi-110cv',
    'volkswagen-golf-vii-2012-2020-1-4-tsi-125cv',
    'volkswagen-polo-vi-2017-1-0-tsi-95cv',
    'volkswagen-passat-b8-2014-2-0-tdi-150cv',
    'volkswagen-tiguan-ii-2016-2-0-tdi-150cv',
    'renault-clio-iv-2012-2019-0-9-tce-90cv',
    'renault-clio-iv-2012-2019-1-5-dci-90cv',
    'renault-clio-v-2019-1-0-tce-100cv',
    'renault-megane-iv-2015-1-5-dci-110cv',
    'renault-captur-ii-2019-1-3-tce-140cv',
    'peugeot-208-i-2012-2019-1-2-puretech-82cv',
    'peugeot-208-ii-2019-1-2-puretech-100cv',
    'peugeot-308-ii-2013-2021-1-6-bluehdi-120cv',
    'peugeot-2008-ii-2019-1-2-puretech-130cv',
    'peugeot-3008-ii-2016-1-5-bluehdi-130cv',
    'citroen-c3-iii-2016-1-2-puretech-82cv',
    'citroen-c4-cactus-i-2014-2020-1-6-bluehdi-100cv',
    'citroen-c3-aircross-i-2017-1-2-puretech-110cv',
    'citroen-berlingo-iii-2018-1-5-bluehdi-130cv',
    'toyota-yaris-iv-2020-1-5-hybrid-116cv',
    'toyota-corolla-e210-2019-1-8-hybrid-122cv',
    'toyota-auris-ii-2012-2018-1-4-d-4d-90cv',
    'toyota-rav4-v-2018-2-5-hybrid-218cv',
    'toyota-c-hr-i-2016-1-8-hybrid-122cv',
    'dacia-sandero-iii-2020-1-0-tce-90cv',
    'dacia-sandero-iii-2020-1-0-tce-eco-g-100cv',
    'dacia-duster-ii-2018-1-5-dci-115cv',
    'dacia-jogger-i-2022-1-0-tce-110cv',
    'ford-fiesta-vii-2017-2023-1-0-ecoboost-100cv',
    'ford-focus-iii-2011-2018-1-6-tdci-115cv',
    'ford-focus-iv-2018-1-0-ecoboost-125cv',
    'ford-kuga-ii-2012-2019-2-0-tdci-150cv',
    'ford-puma-i-2019-1-0-ecoboost-hybrid-125cv',
    'opel-corsa-d-2006-2014-1-4-100cv',
    'opel-corsa-f-2019-1-2-turbo-100cv',
    'opel-astra-k-2015-2021-1-6-cdti-110cv',
    'opel-mokka-b-2020-1-2-turbo-130cv',
    'kia-ceed-iii-2018-1-0-t-gdi-120cv',
    'kia-sportage-iv-2015-2021-1-7-crdi-115cv',
    'kia-picanto-iii-2017-1-0-67cv',
    'kia-niro-i-2016-2022-1-6-gdi-hybrid-141cv',
    'hyundai-i30-iii-2017-1-0-t-gdi-120cv',
    'hyundai-tucson-iii-2015-2020-1-7-crdi-115cv',
    'hyundai-i20-iii-2020-1-0-t-gdi-100cv',
    'hyundai-kona-i-2017-2023-electrico-64-kwh-204cv',
    ]);
  });
});
