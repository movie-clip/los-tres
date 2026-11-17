import 'server-only';

import type { CarContext } from '../car/state';
import { errorCode } from '../error-code';
import { readProductFitState, type FitState } from './fit-state';

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
};

/**
 * The fit outcome of one public product (by slug) for the request's car. Never
 * throws: a failed read gives `unchecked` and one `product-fit: fit failed (<code>)`
 * line. Call it only after the product loader returned a product.
 */
export async function getProductFit(productSlug: string, car: CarContext): Promise<ProductFit> {
  if (car.state !== 'selected') {
    return { banner: null };
  }
  try {
    return { banner: await readProductFitState(productSlug, car.vehicle.id) };
  } catch (error) {
    console.error(`product-fit: fit failed (${errorCode(error)})`);
    return { banner: 'unchecked' };
  }
}
