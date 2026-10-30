// The picker tree and the `/mi-coche` step resolver (S5.7, C3 and C5). Pure: no
// server-only, no database, no environment.

import type { VehicleFuel } from '../../db/schema/vehicles';
import { parseReturnPath, returnPath } from './return-path';
import type { SelectedVehicle } from './state';

/** The vehicle fields the tree is built from; `ActiveVehicle` (vehicles.ts) satisfies it. */
export type PickerVehicle = {
  slug: string;
  make: string;
  makeSlug: string;
  model: string;
  modelSlug: string;
  generation: string;
  yearFrom: number;
  yearTo: number | null;
  engine: string;
  fuel: VehicleFuel;
  powerCv: number;
};

export type PickerEngine = {
  /** The vehicle slug. */
  slug: string;
  /** "1.6 TDI" */
  label: string;
  /** "Diésel · 115 CV" */
  detail: string;
};

export type PickerModel = {
  /** The model slug (make + model + generation). */
  slug: string;
  /** "León III" */
  label: string;
  /** "2012–2020" or "desde 2017" */
  detail: string;
  /** "Elige el motor de Seat León III" */
  heading: string;
  engines: PickerEngine[];
};

export type PickerMake = {
  slug: string;
  /** "Seat" */
  label: string;
  /** "Elige el modelo de Seat" */
  heading: string;
  models: PickerModel[];
};

/**
 * The finished strings the tree needs, built by the caller from the `Car` and
 * `CarPicker` messages. Numbers arrive as plain strings, never grouped: 2012 must
 * not read "2.012".
 */
export type PickerFormat = {
  /** `CarPicker.modelHeading` for a make name. */
  modelHeading(make: string): string;
  /** `CarPicker.engineHeading` for "make model generation". */
  engineHeading(model: string): string;
  /** `CarPicker.years` */
  years(from: string, to: string): string;
  /** `CarPicker.yearsOngoing` */
  yearsOngoing(from: string): string;
  /** `CarPicker.engineDetail`, with the fuel name resolved from the code. */
  engineDetail(fuel: VehicleFuel, power: string): string;
};

/**
 * Makes, their models and their engines, in the order each first appears in the
 * list (the vehicles arrive sorted by position). Only active vehicles are passed,
 * so a make or a model with none has no row to group (ACs 8, 9, 11, 12). A model's
 * years span its vehicles: the earliest start and, unless one is still on sale,
 * the latest end. An empty list gives `[]`.
 */
export function buildPickerOptions(
  vehicles: readonly PickerVehicle[],
  format: PickerFormat,
): PickerMake[] {
  type ModelAcc = { first: PickerVehicle; from: number; to: number | null; engines: PickerEngine[] };
  type MakeAcc = { first: PickerVehicle; models: Map<string, ModelAcc> };
  const makes = new Map<string, MakeAcc>();

  for (const vehicle of vehicles) {
    let make = makes.get(vehicle.makeSlug);
    if (make === undefined) {
      make = { first: vehicle, models: new Map() };
      makes.set(vehicle.makeSlug, make);
    }
    let model = make.models.get(vehicle.modelSlug);
    if (model === undefined) {
      model = { first: vehicle, from: vehicle.yearFrom, to: vehicle.yearTo, engines: [] };
      make.models.set(vehicle.modelSlug, model);
    } else {
      model.from = Math.min(model.from, vehicle.yearFrom);
      model.to =
        model.to === null || vehicle.yearTo === null ? null : Math.max(model.to, vehicle.yearTo);
    }
    model.engines.push({
      slug: vehicle.slug,
      label: vehicle.engine,
      detail: format.engineDetail(vehicle.fuel, String(vehicle.powerCv)),
    });
  }

  return [...makes.entries()].map(([makeSlug, make]) => ({
    slug: makeSlug,
    label: make.first.make,
    heading: format.modelHeading(make.first.make),
    models: [...make.models.entries()].map(([modelSlug, model]) => ({
      slug: modelSlug,
      label: `${model.first.model} ${model.first.generation}`,
      detail:
        model.to === null
          ? format.yearsOngoing(String(model.from))
          : format.years(String(model.from), String(model.to)),
      heading: format.engineHeading(
        `${model.first.make} ${model.first.model} ${model.first.generation}`,
      ),
      engines: model.engines,
    })),
  }));
}

type QueryValue = string | string[] | undefined;

export type PickerQuery = {
  marca?: QueryValue;
  modelo?: QueryValue;
  coche?: QueryValue;
  volver?: QueryValue;
};

type CurrentCar = { makeSlug: string; modelSlug: string; slug: string } | null;

export type PickerStep =
  | { step: 'make'; returnTo: string | null; current: CurrentCar }
  | { step: 'model'; returnTo: string | null; make: PickerMake; current: CurrentCar }
  | {
      step: 'engine';
      returnTo: string | null;
      make: PickerMake;
      model: PickerModel;
      current: CurrentCar;
    }
  | { step: 'done'; location: string };

/**
 * Which `/mi-coche` screen a request is on. A repeated or unknown `marca` is the
 * make step; a `modelo` that is not of that make the model step; a `coche` that is
 * not an engine of that model the engine step; all three consistent is `done`, with
 * the page to return to (`volver`, or home) carrying the new car.
 */
export function resolvePickerStep(
  query: PickerQuery,
  options: readonly PickerMake[],
  current: SelectedVehicle | null,
): PickerStep {
  const returnTo = parseReturnPath(query.volver);
  const here: CurrentCar =
    current === null
      ? null
      : { makeSlug: current.makeSlug, modelSlug: current.modelSlug, slug: current.slug };

  const make =
    typeof query.marca === 'string' ? options.find((m) => m.slug === query.marca) : undefined;
  if (make === undefined) return { step: 'make', returnTo, current: here };

  const model =
    typeof query.modelo === 'string' ? make.models.find((m) => m.slug === query.modelo) : undefined;
  if (model === undefined) return { step: 'model', returnTo, make, current: here };

  const engine =
    typeof query.coche === 'string' ? model.engines.find((e) => e.slug === query.coche) : undefined;
  if (engine === undefined) return { step: 'engine', returnTo, make, model, current: here };

  return { step: 'done', location: returnPath(returnTo, engine.slug) };
}
