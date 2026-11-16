// The selected car as the server sees it (S5.7). Pure: no server-only, no database,
// no environment, so the SEO builder and the unit tests can import it. The server-only
// reader is context.ts, which re-exports everything here.

export type SelectedVehicle = {
  /** Server only: S5.8 and S5.9 pass it to `fitStateSql`. Never sent to the client. */
  id: number;
  slug: string;
  makeSlug: string;
  modelSlug: string;
  /** The finished `Car.name`, for example "Seat León III 1.6 TDI". */
  name: string;
};

/**
 * `path` is the request path and query with `coche` removed, as the proxy
 * forwarded it, or null when it was absent or unusable.
 */
export type CarContext =
  /** No `coche` in the URL. */
  | { state: 'none'; path: string | null }
  | { state: 'selected'; vehicle: SelectedVehicle; path: string | null }
  /** `raw` is the slug-shaped value; null when it was malformed, empty or repeated. */
  | { state: 'unrecognised'; raw: string | null; path: string | null }
  /** The vehicle read failed. */
  | { state: 'unavailable'; path: string | null };

/** True when the URL carried `coche` in any form: the page is not indexable then. */
export function openedWithCoche(car: CarContext): boolean {
  return car.state !== 'none';
}

/** The selected vehicle's slug, else null: what a link carries (D11). */
export function selectedSlug(car: CarContext): string | null {
  return car.state === 'selected' ? car.vehicle.slug : null;
}
