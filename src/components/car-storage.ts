// The browser's memory of the selected car (S5.7, D4). Client only: it touches
// `localStorage` and nothing else. No cookie, no server storage, no log, and the
// only value ever written is a vehicle slug (guardrail 5). Every access is wrapped:
// a browser that refuses storage, or a throwing one, behaves as an empty one and the
// picker still works through the URL.

/** The one storage key. It names no site: a visitor can read it in devtools. */
export const CAR_STORAGE_KEY = 'mi-coche';

// Same shape as the server's slug check (a component never imports src/server).
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 120;

/** Whether `value` is shaped like a vehicle slug. Shape only: the server decides if it is a car. */
export function isSlugShaped(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_FORMAT.test(value);
}

/**
 * The stored slug, or null when nothing is stored, storage is unavailable, or the
 * stored value is not slug-shaped (that value is cleared and never reaches a URL).
 */
export function readStoredCar(): string | null {
  try {
    const value = window.localStorage.getItem(CAR_STORAGE_KEY);
    if (value === null) return null;
    if (isSlugShaped(value)) return value;
    window.localStorage.removeItem(CAR_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

/** Remembers the slug. A refusing storage is ignored: the URL still carries the car. */
export function storeCar(slug: string): void {
  try {
    window.localStorage.setItem(CAR_STORAGE_KEY, slug);
  } catch {
    // Nothing to do: the car lives in the URL for this visit.
  }
}

/** Forgets the stored car. */
export function clearStoredCar(): void {
  try {
    window.localStorage.removeItem(CAR_STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
