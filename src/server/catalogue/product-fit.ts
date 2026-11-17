import 'server-only';

import type { CarContext } from '../car/state';
import { errorCode } from '../error-code';
import {
  readProductFitState,
  readProductVehicles,
  type FitState,
  type FittedVehicle,
} from './fit-state';

// What the product page says about the selected car (S5.9). A supplementary read:
// it degrades instead of failing the page, and it names no visibility flag (the
// read in fit-state.ts re-applies the product scope). It logs one fixed line per
// failed read with an error code only: never the car, the vehicle id, the product
// or its slug (guardrail 5).

/** `unchecked` = the fit read failed, so the page says so instead of guessing. */
export type ProductFitBanner = FitState | 'unchecked';

export type ProductFit = {
  /**
   * Null exactly when the car is not `selected` (none, unrecognised, unavailable).
   * `unchecked` when the fit read failed.
   */
  banner: ProductFitBanner | null;
  /**
   * The product's distinct counted vehicles in vehicle-list order, for every
   * visitor. `[]` = no counted fitment; null = the read failed.
   */
  vehicles: FittedVehicle[] | null;
};

/** The banner read, caught on its own: `null` without a selected car, `unchecked` on a failure. */
async function readBanner(productSlug: string, car: CarContext): Promise<ProductFitBanner | null> {
  if (car.state !== 'selected') {
    return null;
  }
  try {
    return await readProductFitState(productSlug, car.vehicle.id);
  } catch (error) {
    console.error(`product-fit: fit failed (${errorCode(error)})`);
    return 'unchecked';
  }
}

/** The vehicles read, caught on its own: null on a failure. */
async function readVehicles(productSlug: string): Promise<FittedVehicle[] | null> {
  try {
    return await readProductVehicles(productSlug);
  } catch (error) {
    console.error(`product-fit: vehicles failed (${errorCode(error)})`);
    return null;
  }
}

/**
 * The fit outcome of one public product (by slug) for the request's car. Never
 * throws: the banner read and the vehicles read run concurrently and are caught
 * separately, so a failure of one never changes the other's field. A failed banner
 * read gives `unchecked` and one `product-fit: fit failed (<code>)` line; a failed
 * vehicles read gives null and one `product-fit: vehicles failed (<code>)` line.
 * Call it only after the product loader returned a product.
 */
export async function getProductFit(productSlug: string, car: CarContext): Promise<ProductFit> {
  const [banner, vehicles] = await Promise.all([
    readBanner(productSlug, car),
    readVehicles(productSlug),
  ]);
  return { banner, vehicles };
}
