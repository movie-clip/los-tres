import { runInNewContext } from 'node:vm';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CarControlProps } from '@/components/CarControl';
import type { SearchFormProps } from '@/components/SearchForm';
import { SiteHeader } from '@/components/SiteHeader';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import {
  chooseScheme,
  currentScheme,
  STORED_SCHEME,
  subscribeScheme,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
} from '@/components/theme-storage';

import messages from '../../messages/es-ES.json';

// #398 the theme choice below the browser: the head script that sets `data-theme` before first paint (run in
// node:vm against stubs, one case per row of the design), the store the switch writes through, and the markup of
// the switch and of the header around it. The one browser test is journey J13 (tests/e2e/theme.spec.ts).

const LABEL = messages.Theme.toggleLabel;

describe('the stored words are a contract the script, the store and the e2e share', () => {
  it('pins the key and the two stored words, once', () => {
    expect(THEME_STORAGE_KEY).toBe('tema');
    expect(STORED_SCHEME).toEqual({ light: 'claro', dark: 'oscuro' });
  });
});

type Scheme = 'light' | 'dark';
type StorageWorld =
  | { kind: 'values'; values: Record<string, string> }
  | { kind: 'getItem throws' }
  | { kind: 'refused' }
  | { kind: 'absent' };
type System = Scheme | 'no matchMedia' | 'matchMedia throws';

interface World {
  path: string;
  storage: StorageWorld;
  system: System;
}

interface Facts {
  /** Every `setAttribute` on the root element, as [name, value]. */
  attributes: [string, string][];
  /** Every key asked of `getItem`. */
  reads: string[];
  /** Every `setItem`, `removeItem` or `clear`. */
  writes: number;
  /** Every media query asked of `matchMedia`. */
  queries: string[];
  /** Every read or write of `document.cookie`. */
  cookieTouches: number;
}

const stored = (value: string | null): StorageWorld => ({
  kind: 'values',
  values: value === null ? {} : { [THEME_STORAGE_KEY]: value },
});

/** Runs THEME_SCRIPT in a fresh context whose browser objects are stubs that record what the script does. */
function run(world: Partial<World> = {}): Facts {
  const { path = '/', storage = stored(null), system = 'light' } = world;
  const facts: Facts = { attributes: [], reads: [], writes: 0, queries: [], cookieTouches: 0 };

  const document = { documentElement: { setAttribute: (name: string, value: string) => facts.attributes.push([name, value]) } };
  Object.defineProperty(document, 'cookie', {
    get() {
      facts.cookieTouches += 1;
      throw new Error('document.cookie was read');
    },
    set() {
      facts.cookieTouches += 1;
      throw new Error('document.cookie was written');
    },
  });

  const counted = () => {
    facts.writes += 1;
  };
  const localStorage = {
    getItem(key: string): string | null {
      facts.reads.push(key);
      if (storage.kind === 'getItem throws') throw new Error('SecurityError');
      return storage.kind === 'values' ? (storage.values[key] ?? null) : null;
    },
    setItem: counted,
    removeItem: counted,
    clear: counted,
  };
  const matchMedia = (query: string) => {
    facts.queries.push(query);
    if (system === 'matchMedia throws') throw new Error('matchMedia failed');
    return { matches: system === 'dark' };
  };

  // The script may read either `window.x` or the bare global, so each is defined on both.
  const window: Record<string, unknown> = {};
  const sandbox: Record<string, unknown> = { document, location: { pathname: path }, window };
  for (const target of [window, sandbox]) {
    if (storage.kind === 'refused') {
      Object.defineProperty(target, 'localStorage', {
        get() {
          throw new Error('SecurityError');
        },
      });
    } else if (storage.kind !== 'absent') {
      target.localStorage = localStorage;
    }
    if (system !== 'no matchMedia') target.matchMedia = matchMedia;
  }

  runInNewContext(THEME_SCRIPT, sandbox);
  return facts;
}

const schemeOf = (facts: Facts): string | undefined => facts.attributes.at(-1)?.[1];

describe('THEME_SCRIPT: the scheme at first paint, one case per row of the design', () => {
  const CASES: [string, Partial<World>, Scheme][] = [
    ['dark system, empty storage', { system: 'dark' }, 'dark'],
    ['light system, empty storage', { system: 'light' }, 'light'],
    ['claro stored, dark system: the choice wins', { storage: stored('claro'), system: 'dark' }, 'light'],
    ['oscuro stored, light system: the choice wins', { storage: stored('oscuro'), system: 'light' }, 'dark'],
    ['claro stored, light system', { storage: stored('claro'), system: 'light' }, 'light'],
    ['oscuro stored, dark system', { storage: stored('oscuro'), system: 'dark' }, 'dark'],
    ['getItem throws, dark system: the system setting', { storage: { kind: 'getItem throws' }, system: 'dark' }, 'dark'],
    ['getItem throws, light system: the system setting', { storage: { kind: 'getItem throws' }, system: 'light' }, 'light'],
    ['storage refused on access, dark system', { storage: { kind: 'refused' }, system: 'dark' }, 'dark'],
    ['storage refused on access, light system', { storage: { kind: 'refused' }, system: 'light' }, 'light'],
    ['no storage object, dark system', { storage: { kind: 'absent' }, system: 'dark' }, 'dark'],
    ['junk value, dark system: ignored', { storage: stored('otro'), system: 'dark' }, 'dark'],
    ['junk value, light system: ignored', { storage: stored('otro'), system: 'light' }, 'light'],
    ['empty string stored, dark system: ignored', { storage: stored(''), system: 'dark' }, 'dark'],
    ['OSCURO in capitals is junk, light system', { storage: stored('OSCURO'), system: 'light' }, 'light'],
    ['a padded value is junk, light system', { storage: stored(' oscuro '), system: 'light' }, 'light'],
    ['the English word is junk, light system', { storage: stored('dark'), system: 'light' }, 'light'],
    ['no matchMedia and empty storage: light', { system: 'no matchMedia' }, 'light'],
    ['matchMedia throws and empty storage: light', { system: 'matchMedia throws' }, 'light'],
    ['no matchMedia but oscuro stored: dark', { storage: stored('oscuro'), system: 'no matchMedia' }, 'dark'],
    ['nothing works: light', { storage: { kind: 'refused' }, system: 'no matchMedia' }, 'light'],
  ];

  it.each(CASES)('%s', (_name, world, expected) => {
    expect(schemeOf(run(world))).toBe(expected);
  });

  it('asks for the dark system setting by its media query, and only when the storage did not decide', () => {
    expect(run({ system: 'dark' }).queries).toEqual(['(prefers-color-scheme: dark)']);
    expect(run({ storage: stored('oscuro'), system: 'dark' }).queries).toEqual([]);
    expect(run({ storage: stored('claro'), system: 'dark' }).queries).toEqual([]);
    expect(run({ storage: stored('otro'), system: 'dark' }).queries).toEqual(['(prefers-color-scheme: dark)']);
  });

  it.each(['/admin', '/admin/', '/admin/tiendas', '/admin/acceso'])(
    'admin path %s is dark whatever is stored or set, and reads nothing',
    (path) => {
      for (const storage of [stored('claro'), stored('oscuro'), stored(null), { kind: 'getItem throws' } as const]) {
        const facts = run({ path, storage, system: 'light' });
        expect(schemeOf(facts)).toBe('dark');
        expect(facts.reads).toEqual([]);
        expect(facts.queries).toEqual([]);
      }
    },
  );

  it.each(['/', '/administrar', '/admin-x', '/productos/admin', '/categoria/aceite-de-motor', '/mi-coche'])(
    'public path %s follows the stored choice, so only the admin area is forced dark',
    (path) => {
      expect(schemeOf(run({ path, storage: stored('claro'), system: 'dark' }))).toBe('light');
    },
  );

  it('sets data-theme once on the root, and reads only the one key', () => {
    for (const [, world] of CASES) {
      const facts = run(world);
      expect(facts.attributes).toHaveLength(1);
      expect(facts.attributes[0][0]).toBe('data-theme');
      expect(['light', 'dark']).toContain(facts.attributes[0][1]);
      expect(facts.reads.every((key) => key === THEME_STORAGE_KEY)).toBe(true);
    }
  });

  it('never writes storage and never touches document.cookie, in any case, admin or not', () => {
    for (const path of ['/', '/admin']) {
      for (const [, world] of CASES) {
        const facts = run({ ...world, path });
        expect(facts.writes, `${path} ${JSON.stringify(world)}`).toBe(0);
        expect(facts.cookieTouches, `${path} ${JSON.stringify(world)}`).toBe(0);
      }
    }
  });

  it('is a constant string with no network, cookie or storage write in it', () => {
    expect(typeof THEME_SCRIPT).toBe('string');
    for (const word of ['cookie', 'setItem', 'removeItem', 'clear(', 'fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'Image(']) {
      expect(THEME_SCRIPT, word).not.toContain(word);
    }
  });

  it('is not left to the page: it is not wrapped in a script tag and has no placeholder left in it', () => {
    expect(THEME_SCRIPT).not.toMatch(/<\/?script/i);
    expect(THEME_SCRIPT).not.toMatch(/\$\{|undefined|\[object/);
  });
});

/** A root element and a storage the store can write to, installed as the browser globals. */
function installBrowser(options: { setItemThrows?: boolean; storageRefused?: boolean } = {}) {
  const attributes = new Map<string, string>();
  const values = new Map<string, string>();
  const setItems: [string, string][] = [];
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
  };
  const windowStub: Record<string, unknown> = {};
  if (options.storageRefused) {
    Object.defineProperty(windowStub, 'localStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
  } else {
    windowStub.localStorage = {
      setItem(key: string, value: string) {
        if (options.setItemThrows) throw new Error('QuotaExceededError');
        setItems.push([key, value]);
        values.set(key, value);
      },
      getItem: (key: string) => values.get(key) ?? null,
    };
  }
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', windowStub);
  return { attributes, values, setItems, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the store: currentScheme, chooseScheme and subscribeScheme', () => {
  it('reads dark only when the root attribute is exactly dark', () => {
    const { root } = installBrowser();
    expect(currentScheme()).toBe('light');
    for (const [value, expected] of [
      ['dark', 'dark'],
      ['light', 'light'],
      ['oscuro', 'light'],
      ['DARK', 'light'],
      ['', 'light'],
    ] as const) {
      root.setAttribute('data-theme', value);
      expect(currentScheme(), value).toBe(expected);
    }
  });

  it('chooseScheme(dark) sets the attribute and stores oscuro under tema', () => {
    const { attributes, setItems } = installBrowser();
    chooseScheme('dark');
    expect(attributes.get('data-theme')).toBe('dark');
    expect(setItems).toEqual([['tema', 'oscuro']]);
  });

  it('chooseScheme(light) sets the attribute and stores claro under tema', () => {
    const { attributes, setItems } = installBrowser();
    chooseScheme('light');
    expect(attributes.get('data-theme')).toBe('light');
    expect(setItems).toEqual([['tema', 'claro']]);
  });

  it('keeps the page in the chosen scheme when storage throws on write or refuses access, and does not throw', () => {
    for (const options of [{ setItemThrows: true }, { storageRefused: true }]) {
      const { attributes } = installBrowser(options);
      expect(() => chooseScheme('dark')).not.toThrow();
      expect(attributes.get('data-theme'), JSON.stringify(options)).toBe('dark');
      expect(currentScheme()).toBe('dark');
      vi.unstubAllGlobals();
    }
  });

  it('notifies every subscriber after a choice, also when storage failed, and not after unsubscribing', () => {
    installBrowser({ setItemThrows: true });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeScheme(first);
    const stopSecond = subscribeScheme(second);
    chooseScheme('dark');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    chooseScheme('light');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
    chooseScheme('dark');
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('notifies after the attribute changed, so a listener reads the new scheme', () => {
    installBrowser();
    const seen: Scheme[] = [];
    const stop = subscribeScheme(() => seen.push(currentScheme()));
    chooseScheme('dark');
    chooseScheme('light');
    stop();
    expect(seen).toEqual(['dark', 'light']);
  });

  it('writes what the head script reads: a choice survives into the next first paint, against the system setting', () => {
    const { values } = installBrowser();
    chooseScheme('dark');
    expect(schemeOf(run({ storage: { kind: 'values', values: Object.fromEntries(values) }, system: 'light' }))).toBe('dark');
    chooseScheme('light');
    expect(schemeOf(run({ storage: { kind: 'values', values: Object.fromEntries(values) }, system: 'dark' }))).toBe('light');
  });
});

describe('ThemeSwitch markup as the server draws it', () => {
  const html = renderToStaticMarkup(createElement(ThemeSwitch, { label: LABEL }));

  it('is one button of type button named by its label, with no other text', () => {
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toMatch(/^<button [^>]*type="button"/);
    expect(html.replace(/<[^>]*>/g, '')).toBe(LABEL);
  });

  it('hides the glyph from assistive technology and carries the name in a text span', () => {
    expect(html).toMatch(/<span [^>]*aria-hidden="true"><\/span>/);
    expect(html).toMatch(new RegExp(`<span [^>]*>${LABEL}</span>`));
    expect(html).not.toContain('aria-label');
  });

  it('carries no pressed state before hydration, so the server and the first client render agree', () => {
    expect(html).not.toContain('aria-pressed');
  });

  it('takes the name from its prop', () => {
    expect(renderToStaticMarkup(createElement(ThemeSwitch, { label: 'OTRO NOMBRE' }))).toContain('>OTRO NOMBRE<');
  });
});

describe('SiteHeader around the switch', () => {
  const search: SearchFormProps = {
    variant: 'header',
    action: '/buscar',
    formLabel: 'Buscar',
    fieldLabel: 'Buscar un producto',
    button: 'Buscar',
    hint: null,
    value: null,
  };
  const CAR = { slug: 'una-version', makeSlug: 'una-marca', modelSlug: 'un-modelo', name: 'Una versión' };
  const car = (selected: boolean): CarControlProps => ({
    car: selected ? CAR : null,
    unrecognised: null,
    cochePresent: selected,
    options: [],
    links: { select: '/mi-coche', change: selected ? '/mi-coche?coche=x' : null, remove: selected ? '/' : null },
    strings: {
      groupLabel: 'GRUPO',
      select: 'SELECCIONAR',
      selected: selected ? 'MI-COCHE' : null,
      change: 'CAMBIAR',
      changeLabel: 'CAMBIAR-ETIQUETA',
      remove: 'QUITAR',
      removeLabel: 'QUITAR-ETIQUETA',
      dialog: {
        title: 'T',
        close: 'C',
        closeLabel: 'CL',
        picker: {} as CarControlProps['strings']['dialog']['picker'],
      },
    },
  });
  const render = (props: { search?: SearchFormProps | null; car?: CarControlProps | null; themeLabel?: string }) =>
    renderToStaticMarkup(createElement(SiteHeader, { siteName: 'Sitio de prueba', search, ...props }));

  /** The inside of the first `<div>` whose class starts with `_<name>_` (the module's name, hashed), or null. */
  function group(html: string, name: string): string | null {
    const start = html.indexOf(`<div class="_${name}_`);
    if (start === -1) return null;
    const tags = /<div\b|<\/div>/g;
    tags.lastIndex = start;
    let depth = 0;
    for (let tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) return html.slice(html.indexOf('>', start) + 1, tag.index);
    }
    return null;
  }
  const switchIn = (html: string | null) => (html ?? '').includes(`>${LABEL}</span></button>`);

  it('draws no switch without a themeLabel, with or without a car', () => {
    for (const props of [{}, { car: car(false) }, { car: car(true) }, { search: null }]) {
      expect(render(props), JSON.stringify(Object.keys(props))).not.toContain(LABEL);
    }
  });

  it('with no car selected puts the car control and then the switch in one trailing group of row 1', () => {
    const html = render({ car: car(false), themeLabel: LABEL });
    const row1 = group(html, 'inner');
    const trailing = group(html, 'trailing');
    expect(row1).not.toBeNull();
    expect(trailing).not.toBeNull();
    expect(row1).toContain(trailing as string);
    expect(trailing).toContain('data-testid="car-control"');
    expect(switchIn(trailing)).toBe(true);
    expect((trailing as string).indexOf('car-control')).toBeLessThan((trailing as string).indexOf(LABEL));
    expect(group(html, 'carRow')).toBeNull();
  });

  it('keeps the site name, then the search, before the group', () => {
    const html = render({ car: car(false), themeLabel: LABEL });
    const at = (needle: string) => html.indexOf(needle);
    expect(at('site-header-link')).toBeLessThan(at('header-search"'));
    expect(at('header-search"')).toBeLessThan(at('data-testid="car-control"'));
    expect(at('data-testid="car-control"')).toBeLessThan(at(`>${LABEL}<`));
  });

  it('with a car selected puts the switch alone in row 1 and the car control in row 2', () => {
    const html = render({ car: car(true), themeLabel: LABEL });
    const row1 = group(html, 'inner');
    const trailing = group(html, 'trailing');
    const row2 = group(html, 'carRow');
    expect(switchIn(trailing)).toBe(true);
    expect(trailing).not.toContain('car-control');
    expect(row1).toContain(`>${LABEL}<`);
    expect(row1).not.toContain('car-control');
    expect(row2).toContain('data-testid="car-control"');
    expect(row2).not.toContain(LABEL);
    expect(html.indexOf(`>${LABEL}<`)).toBeLessThan(html.indexOf('data-testid="car-control"'));
  });

  it('keeps the switch with no car control at all (the picker page) and with no search box', () => {
    for (const props of [{ car: null }, { car: null, search: null }, { search: null }]) {
      const html = render({ ...props, themeLabel: LABEL });
      expect(switchIn(group(html, 'trailing')), JSON.stringify(Object.keys(props))).toBe(true);
      expect(html).not.toContain('car-control');
    }
  });

  it('draws one switch, never two', () => {
    for (const selected of [false, true]) {
      const html = render({ car: car(selected), themeLabel: LABEL });
      expect(html.split(`>${LABEL}<`)).toHaveLength(2);
    }
  });
});
