import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CAR_STORAGE_KEY,
  clearStoredCar,
  isSlugShaped,
  readStoredCar,
  storeCar,
} from '@/components/car-storage';

// M1 (#339): the browser's memory of the selected car, with `window.localStorage` stubbed in node.
// The e2e journey J6 keeps the round trip in a real browser; the edge cases live here.

const SLUG = 'seat-leon-iii-2012-2020-1-6-tdi-105cv';

type Store = Map<string, string>;

/** A working storage over a map. The map is returned so a test can read what the code left. */
function stubStorage(initial: Record<string, string> = {}): Store {
  const store: Store = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

/** A storage whose chosen methods throw, as a browser that refuses storage does. */
function stubThrowing(throwing: ('getItem' | 'setItem' | 'removeItem')[]): void {
  const fail = () => {
    throw new Error('storage refused');
  };
  vi.stubGlobal('window', {
    localStorage: {
      getItem: throwing.includes('getItem') ? fail : () => null,
      setItem: throwing.includes('setItem') ? fail : () => undefined,
      removeItem: throwing.includes('removeItem') ? fail : () => undefined,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('car-storage: reading (M1)', () => {
  it('reads null when nothing is stored', () => {
    stubStorage();
    expect(readStoredCar()).toBeNull();
  });

  it('returns a slug-shaped value and leaves it stored', () => {
    const store = stubStorage({ [CAR_STORAGE_KEY]: SLUG });
    expect(readStoredCar()).toBe(SLUG);
    expect(store.get(CAR_STORAGE_KEY)).toBe(SLUG);
  });

  it.each(['SEAT LEON', '../etc/passwd', '<script>x()</script>', 'a--b', '-a', 'a-', '', `a${'-b'.repeat(100)}`])(
    'clears a value that is not slug-shaped (%j) and reads null',
    (value) => {
      const store = stubStorage({ [CAR_STORAGE_KEY]: value, other: 'kept' });
      expect(readStoredCar()).toBeNull();
      expect(store.has(CAR_STORAGE_KEY)).toBe(false);
      expect(store.get('other')).toBe('kept');
    },
  );

  it('reads null, without throwing, when getItem throws', () => {
    stubThrowing(['getItem']);
    expect(readStoredCar()).toBeNull();
  });

  it('reads null, without throwing, when clearing a bad value throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'NOT A SLUG',
        removeItem: () => {
          throw new Error('storage refused');
        },
      },
    });
    expect(readStoredCar()).toBeNull();
  });

  it('reads null when localStorage itself is not reachable', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('access denied');
      },
    });
    expect(readStoredCar()).toBeNull();
  });
});

describe('car-storage: writing and clearing (M1)', () => {
  it('stores the slug under the one key and nothing else', () => {
    const store = stubStorage();
    storeCar(SLUG);
    expect([...store.entries()]).toEqual([[CAR_STORAGE_KEY, SLUG]]);
  });

  it('is tolerated when setItem throws', () => {
    stubThrowing(['setItem']);
    expect(() => storeCar(SLUG)).not.toThrow();
  });

  it('clears only its own key', () => {
    const store = stubStorage({ [CAR_STORAGE_KEY]: SLUG, other: 'kept' });
    clearStoredCar();
    expect(store.has(CAR_STORAGE_KEY)).toBe(false);
    expect(store.get('other')).toBe('kept');
  });

  it('is tolerated when removeItem throws', () => {
    stubThrowing(['removeItem']);
    expect(() => clearStoredCar()).not.toThrow();
  });

  it('is tolerated when localStorage itself is not reachable', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('access denied');
      },
    });
    expect(() => storeCar(SLUG)).not.toThrow();
    expect(() => clearStoredCar()).not.toThrow();
  });

  it('names the key "mi-coche" and no site', () => {
    expect(CAR_STORAGE_KEY).toBe('mi-coche');
  });
});

describe('car-storage: slug shape (M1)', () => {
  it('accepts a slug and refuses one past 120 characters', () => {
    expect(isSlugShaped(SLUG)).toBe(true);
    expect(isSlugShaped('a'.repeat(120))).toBe(true);
    expect(isSlugShaped('a'.repeat(121))).toBe(false);
  });
});
