import { describe, expect, it } from 'vitest';

import {
  buildPickerOptions,
  resolvePickerStep,
  type PickerFormat,
  type PickerMake,
  type PickerVehicle,
} from '@/server/car/picker';
import type { SelectedVehicle } from '@/server/car/state';

// The picker tree (C3) and the /mi-coche step resolver (C5).

const format: PickerFormat = {
  modelHeading: (make) => `modelo de ${make}`,
  engineHeading: (model) => `motor de ${model}`,
  years: (from, to) => `${from}-${to}`,
  yearsOngoing: (from) => `desde ${from}`,
  engineDetail: (fuel, power) => `${fuel}/${power}`,
};

let n = 0;
function vehicle(o: Partial<PickerVehicle> = {}): PickerVehicle {
  n += 1;
  return {
    slug: `v-${n}`,
    make: 'Seat',
    makeSlug: 'seat',
    model: 'León',
    modelSlug: 'seat-leon-iii',
    generation: 'III',
    yearFrom: 2012,
    yearTo: 2020,
    engine: '1.6 TDI',
    fuel: 'diesel',
    powerCv: 115,
    ...o,
  };
}

describe('buildPickerOptions', () => {
  it('is an empty list for no vehicles', () => {
    expect(buildPickerOptions([], format)).toEqual([]);
  });

  it('groups make, model and engine with finished strings', () => {
    const tree = buildPickerOptions([vehicle({ slug: 'a' })], format);
    expect(tree).toEqual([
      {
        slug: 'seat',
        label: 'Seat',
        heading: 'modelo de Seat',
        models: [
          {
            slug: 'seat-leon-iii',
            label: 'León III',
            detail: '2012-2020',
            heading: 'motor de Seat León III',
            engines: [{ slug: 'a', label: '1.6 TDI', detail: 'diesel/115' }],
          },
        ],
      },
    ]);
  });

  it('keeps first-seen order of the input for makes, models and engines', () => {
    const tree = buildPickerOptions(
      [
        vehicle({ slug: 'f1', make: 'Ford', makeSlug: 'ford', model: 'Focus', modelSlug: 'ford-focus', generation: 'IV' }),
        vehicle({ slug: 's1' }),
        vehicle({ slug: 'f2', make: 'Ford', makeSlug: 'ford', model: 'Focus', modelSlug: 'ford-focus', generation: 'IV' }),
        vehicle({ slug: 's2', model: 'Ibiza', modelSlug: 'seat-ibiza-v', generation: 'V' }),
        vehicle({ slug: 's3' }),
      ],
      format,
    );
    expect(tree.map((m) => m.slug)).toEqual(['ford', 'seat']);
    expect(tree[0].models[0].engines.map((e) => e.slug)).toEqual(['f1', 'f2']);
    expect(tree[1].models.map((m) => m.slug)).toEqual(['seat-leon-iii', 'seat-ibiza-v']);
    expect(tree[1].models[0].engines.map((e) => e.slug)).toEqual(['s1', 's3']);
  });

  it('spans the years of a model: earliest start, latest end', () => {
    const tree = buildPickerOptions(
      [vehicle({ yearFrom: 2014, yearTo: 2016 }), vehicle({ yearFrom: 2012, yearTo: 2020 }), vehicle({ yearFrom: 2013, yearTo: 2018 })],
      format,
    );
    expect(tree[0].models[0].detail).toBe('2012-2020');
  });

  it('is "desde" when any vehicle of the model is still on sale', () => {
    const tree = buildPickerOptions(
      [vehicle({ yearFrom: 2017, yearTo: 2019 }), vehicle({ yearFrom: 2015, yearTo: null })],
      format,
    );
    expect(tree[0].models[0].detail).toBe('desde 2015');
  });

  it('writes years as plain digits, never grouped', () => {
    const seen: string[] = [];
    buildPickerOptions([vehicle({ yearFrom: 2012, yearTo: 2020 })], {
      ...format,
      years: (from, to) => {
        seen.push(from, to);
        return '';
      },
    });
    expect(seen).toEqual(['2012', '2020']);
  });

  it('passes the power as a plain string', () => {
    const seen: string[] = [];
    buildPickerOptions([vehicle({ powerCv: 1050 })], {
      ...format,
      engineDetail: (_fuel, power) => {
        seen.push(power);
        return '';
      },
    });
    expect(seen).toEqual(['1050']);
  });

  it('has no make or model that was not in the list (ACs 8, 9, 11, 12)', () => {
    const tree = buildPickerOptions([vehicle({ makeSlug: 'seat' })], format);
    expect(tree).toHaveLength(1);
    expect(tree[0].models).toHaveLength(1);
  });
});

describe('resolvePickerStep', () => {
  const options: PickerMake[] = buildPickerOptions(
    [
      vehicle({ slug: 'leon-tdi' }),
      vehicle({ slug: 'leon-tsi', engine: '1.4 TSI', fuel: 'gasolina' }),
      vehicle({ slug: 'ibiza-1', model: 'Ibiza', modelSlug: 'seat-ibiza-v', generation: 'V' }),
      vehicle({ slug: 'focus-1', make: 'Ford', makeSlug: 'ford', model: 'Focus', modelSlug: 'ford-focus', generation: 'IV' }),
    ],
    format,
  );
  const car: SelectedVehicle = {
    id: 1,
    slug: 'leon-tdi',
    makeSlug: 'seat',
    modelSlug: 'seat-leon-iii',
    name: 'Seat León III 1.6 TDI',
  };

  it('starts at the make step with no query', () => {
    expect(resolvePickerStep({}, options, null)).toEqual({ step: 'make', returnTo: null, current: null });
  });

  it('carries the current car slugs, never its id', () => {
    const step = resolvePickerStep({}, options, car);
    expect(step).toEqual({
      step: 'make',
      returnTo: null,
      current: { makeSlug: 'seat', modelSlug: 'seat-leon-iii', slug: 'leon-tdi' },
    });
    expect(JSON.stringify(step)).not.toContain('"id"');
  });

  it('goes to the model step for a known make', () => {
    const step = resolvePickerStep({ marca: 'seat' }, options, null);
    expect(step).toMatchObject({ step: 'model', make: { slug: 'seat' } });
  });

  it('goes to the engine step for a model of that make', () => {
    const step = resolvePickerStep({ marca: 'seat', modelo: 'seat-leon-iii' }, options, null);
    expect(step).toMatchObject({ step: 'engine', make: { slug: 'seat' }, model: { slug: 'seat-leon-iii' } });
  });

  it('is done when make, model and engine agree, returning home with the car', () => {
    expect(resolvePickerStep({ marca: 'seat', modelo: 'seat-leon-iii', coche: 'leon-tsi' }, options, null)).toEqual({
      step: 'done',
      location: '/?coche=leon-tsi',
    });
  });

  it('returns to a valid volver with the car last', () => {
    const step = resolvePickerStep(
      { marca: 'seat', modelo: 'seat-leon-iii', coche: 'leon-tsi', volver: '/categoria/f?pagina=2' },
      options,
      null,
    );
    expect(step).toEqual({ step: 'done', location: '/categoria/f?pagina=2&coche=leon-tsi' });
  });

  it('ignores a hostile volver and goes home', () => {
    const step = resolvePickerStep(
      { marca: 'seat', modelo: 'seat-leon-iii', coche: 'leon-tsi', volver: '/.//evil.example' },
      options,
      null,
    );
    expect(step).toEqual({ step: 'done', location: '/?coche=leon-tsi' });
  });

  it('keeps a valid volver on the step screens and drops a hostile one', () => {
    expect(resolvePickerStep({ marca: 'seat', volver: '/buscar?q=a' }, options, null)).toMatchObject({
      step: 'model',
      returnTo: '/buscar?q=a',
    });
    expect(resolvePickerStep({ volver: '//evil.example' }, options, null)).toMatchObject({
      step: 'make',
      returnTo: null,
    });
  });

  it.each([
    ['an unknown make', { marca: 'nope' }],
    ['a repeated make', { marca: ['seat', 'ford'] }],
    ['a make with an unknown model and engine', { marca: 'nope', modelo: 'seat-leon-iii', coche: 'leon-tdi' }],
    ['an empty make', { marca: '' }],
  ])('falls back to the make step for %s', (_label, query) => {
    expect(resolvePickerStep(query, options, null).step).toBe('make');
  });

  it.each([
    ['a model of another make', { marca: 'ford', modelo: 'seat-leon-iii' }],
    ['an unknown model', { marca: 'seat', modelo: 'nope' }],
    ['a repeated model', { marca: 'seat', modelo: ['seat-leon-iii', 'seat-ibiza-v'] }],
    ['a model with an engine of another model', { marca: 'seat', modelo: 'nope', coche: 'leon-tdi' }],
  ])('falls back to the model step for %s', (_label, query) => {
    expect(resolvePickerStep(query, options, null).step).toBe('model');
  });

  it.each([
    ['an engine of another model', { marca: 'seat', modelo: 'seat-leon-iii', coche: 'ibiza-1' }],
    ['an unknown engine', { marca: 'seat', modelo: 'seat-leon-iii', coche: 'nope' }],
    ['a repeated engine', { marca: 'seat', modelo: 'seat-leon-iii', coche: ['leon-tdi', 'leon-tsi'] }],
    ['a retired engine (not in the tree)', { marca: 'seat', modelo: 'seat-leon-iii', coche: 'retired-one' }],
  ])('falls back to the engine step for %s', (_label, query) => {
    expect(resolvePickerStep(query, options, null).step).toBe('engine');
  });

  it('is the make step for every query when there are no options', () => {
    expect(resolvePickerStep({ marca: 'seat' }, [], null).step).toBe('make');
  });
});
