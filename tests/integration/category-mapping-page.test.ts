import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/db/client';
import { assignCategory } from '@/server/admin/category-mappings';

import messages from '../../messages/es-ES.json';
import { SITE_ORIGIN, createAdmin, forge, signInForCookie } from '../support/admin';
import { aFeed, categoryForm, fiveTargets, offerOf, productIn } from '../support/categories';
import { insertCategoryMapping } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// S4.2 (T4.2.3), the page at /admin/categorias rendered from the real page module with a real
// translator, so the markup is what the browser's first response carries: AC 1 (guard in the
// page and in its metadata), 10 (a host and nothing more, in the markup and in the data a client
// part receives), 16 (no feed at all, the states of a feed with nothing to list), 41 (no control
// that approves, disables or hides), 46 and 47 on the rendered copy, 50.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('use-intl/core');
  const all = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'es-ES', messages: all, namespace } as never) as unknown,
    getMessages: async () => all,
  };
});
// The provider infers its locale from the request config under Next; give it one here.
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    NextIntlClientProvider: (props: Record<string, unknown>) =>
      createElement(actual.NextIntlClientProvider as never, { locale: 'es-ES', ...props }),
  };
});

const copy = messages.Admin.Categories;
const KEY = 'KEY-SENTINEL-3b90';
const SECRET_URL = `https://user:PASS-SENTINEL@feeds.example:8443/ruta/secreta.csv?apikey=${KEY}#frag`;

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

async function signIn() {
  await createAdmin();
  const session = await signInForCookie();
  startAdminRequest({ cookie: session.cookie, origin: SITE_ORIGIN });
  return session;
}

async function load() {
  return (await import('@/app/admin/(shell)/categorias/page')).default;
}

/** The server render the browser's first response carries. */
async function render(): Promise<{ html: string; payload: string }> {
  const Page = await load();
  const element = await Page();
  return { html: renderToStaticMarkup(element as never), payload: JSON.stringify(element) };
}

describe('the page is guarded in its body and in its metadata (AC 1)', () => {
  it.each([
    ['no cookie', undefined],
    ['a forged cookie', 'admin.session_token=forged.value'],
  ])('%s: the page and generateMetadata redirect to sign-in and read nothing first', async (_name, cookie) => {
    const { default: Page, generateMetadata } = await import('@/app/admin/(shell)/categorias/page');
    await aFeed({ url: SECRET_URL });
    startAdminRequest({ cookie, origin: SITE_ORIGIN });
    expect(await redirectOf(() => Page())).toBe('/admin/acceso?aviso=sesion');
    startAdminRequest({ cookie, origin: SITE_ORIGIN });
    expect(await redirectOf(() => generateMetadata())).toBe('/admin/acceso?aviso=sesion');
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('a forged copy of a live cookie is refused too', async () => {
    const live = await signIn();
    const { default: Page } = await import('@/app/admin/(shell)/categorias/page');
    startAdminRequest({ cookie: forge(live.cookie), origin: SITE_ORIGIN });
    expect(await redirectOf(() => Page())).toBe('/admin/acceso?aviso=sesion');
  });

  it('a signed-in admin gets the page title and the screen sets no cookie', async () => {
    await signIn();
    const { generateMetadata } = await import('@/app/admin/(shell)/categorias/page');
    const metadata = await generateMetadata();
    expect(String(metadata.title)).toContain(messages.Admin.Meta.categoriesTitle.split(' | ')[0]);
    await render();
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('is a dynamic page, so a save is read on the next request', async () => {
    const page = await import('@/app/admin/(shell)/categorias/page');
    expect(page.dynamic).toBe('force-dynamic');
  });
});

describe('no feed at all, and a feed with nothing to list (AC 16)', () => {
  it('renders the empty message and the way out to the shops page, with no summary and no list', async () => {
    await signIn();

    const { html } = await render();

    expect(html).toContain(copy.heading);
    expect(html).toContain('data-testid="categories-empty"');
    expect(html).toContain(copy.feedsEmpty);
    expect(html).toMatch(/<a [^>]*href="\/admin\/tiendas"[^>]*data-testid="categories-empty-link"/);
    expect(html).not.toContain('data-testid="categories-summary"');
    expect(html).not.toContain('data-testid="categories-list"');
  });

  it('a feed never imported says so, with no groups and no control', async () => {
    await signIn();
    const { feedId } = await aFeed();

    const { html } = await render();

    expect(html).toContain(`data-testid="category-feed-${feedId}"`);
    expect(html).toContain(copy.feedNeverImported);
    expect(html).not.toContain('data-testid="category-group-');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<button');
  });

  it('a feed with offers and no category column says it brings none, counts all its products and shows no control', async () => {
    await signIn();
    const { feedId } = await aFeed();
    await productIn(feedId, null);
    await productIn(feedId, null);

    const { html } = await render();

    expect(html).toContain(copy.feedNoCategories);
    expect(html).not.toContain(copy.feedNeverImported);
    expect(html).toContain('data-testid="category-feed-empty-cells"');
    expect(html).toContain('2 productos de este feed no traen categoría');
    expect(html).not.toContain('data-testid="category-group-');
    expect(html).not.toContain('<select');
  });
});

describe('a feed with categories (AC 10 to 15, 17)', () => {
  async function world() {
    await signIn();
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed({ url: SECRET_URL });
    await productIn(feedId, 'Filtros');
    await productIn(feedId, 'Filtros');
    await productIn(feedId, 'filtros');
    const both = await productIn(feedId, 'Asignada');
    await offerOf(both.id, feedId, 'Fuera');
    await productIn(feedId, null);
    await insertCategoryMapping(feedId, 'Sin ofertas', aceite.id);
    await assignCategory(categoryForm({ feedId, feedCategory: 'Asignada', target: aceite.id }));
    return { feedId, aceite };
  }

  it('shows the not-reviewed group above the reviewed one, with each state, count and the zero note', async () => {
    const { aceite } = await world();

    const { html } = await render();

    expect(html.indexOf('data-testid="category-group-pending"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="category-group-pending"')).toBeLessThan(html.indexOf('data-testid="category-group-reviewed"'));
    const names = [...html.matchAll(/data-testid="category-name">([^<]*)</g)].map((match) => match[1]);
    expect(names.slice(0, 3).sort()).toEqual(['Fuera', 'Filtros', 'filtros'].sort());
    expect(names).toEqual(expect.arrayContaining(['Asignada', 'Sin ofertas']));
    expect(html).toContain(`Asignada a ${aceite.name}`);
    expect(html).toContain('2 productos');
    expect(html).toContain('1 producto<');
    expect(html).toContain(copy.rowCountZero);
    expect(html).toContain('Sin revisar (3)');
    expect(html).toContain('Revisadas (2)');
    expect(html).toContain('data-testid="category-feed-empty-cells"');
  });

  it('summarises feeds and the categories still to review with real plurals', async () => {
    await world();
    await aFeed();

    const { html } = await render();

    expect(html).toMatch(/data-testid="categories-summary">2 feeds · 3 categorías sin revisar</);
    expect(html).toMatch(/data-testid="category-feed-summary">5 categorías · 3 sin revisar</);
  });

  it('puts the three rule sentences, then the summary, after the heading, in that order', async () => {
    await world();

    const { html } = await render();

    const positions = [copy.heading, copy.intro, copy.rulePublic, copy.ruleRemove, 'data-testid="categories-summary"'].map((text) => html.indexOf(text.replace(/&/g, '&amp;')));
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows a host and nothing more of the feed address: not in the markup, not in the data a client part receives (AC 10)', async () => {
    await world();

    const { html, payload } = await render();

    expect(html).toContain('feeds.example');
    for (const [name, text] of [['markup', html], ['client payload', payload]]) {
      expect(text, name).not.toMatch(/PASS-SENTINEL|KEY-SENTINEL|8443|ruta|secreta|frag|apikey|https?:\/\/|user:/);
    }
  });

  it('offers each row a select labelled and named by its category, and a form field for the stored string only', async () => {
    await world();

    const { html } = await render();

    const selects = [...html.matchAll(/<select id="([^"]+)" name="target" aria-labelledby="([^"]+)"/g)];
    expect(selects.length).toBe(5);
    expect(new Set(selects.map((match) => match[2])).size).toBe(5); // every select has its own accessible name
    for (const [, id, labelledBy] of selects) {
      const [labelId, nameId] = labelledBy.split(' ');
      expect(html).toContain(`<label id="${labelId}" for="${id}"`);
      expect(html).toContain(`id="${nameId}"`);
    }
    // The five and the prompt, never the root.
    expect(html).not.toContain('Mantenimiento del coche');
    for (const label of ['Aceite de motor', 'Filtros de aceite', 'Filtros de aire', 'Filtros de combustible', 'Filtros de habitáculo']) {
      expect(html).toContain(`>${label}</option>`);
    }
  });
});

describe('the screen offers no way to approve, disable or hide (AC 41)', () => {
  it('every button is one of the mapping buttons, and there is no checkbox, link to an approval or a hide control', async () => {
    await signIn();
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed({ approved: false, shopApproved: false });
    await productIn(feedId, 'Pendiente', { product: { isHidden: true } });
    await productIn(feedId, 'Asignada');
    await productIn(feedId, 'Fuera');
    await assignCategory(categoryForm({ feedId, feedCategory: 'Asignada', target: aceite.id }));
    await assignCategory(categoryForm({ feedId, feedCategory: 'Fuera', target: aceite.id }));
    const { markOutsideScope } = await import('@/server/admin/category-mappings');
    await markOutsideScope(categoryForm({ feedId, feedCategory: 'Fuera' }));

    const { html } = await render();

    const allowed = new Set(['category-assign', 'category-change', 'category-mark-outside', 'category-remove', 'category-unmark']);
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(allowed.has(/data-testid="([^"]+)"/.exec(button)?.[1] ?? ''), button).toBe(true);
    expect(html).not.toMatch(/type="checkbox"|role="switch"|type="radio"/);
    expect(html).not.toMatch(/name="(isApproved|isHidden|approved|hidden|enabled)"/i);
    // The only links on the screen leave to the shops page or are the admin shell's own.
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.every((href) => href === '/admin/tiendas')).toBe(true);
    // The not-approved feed says so; it does not say it can be approved here.
    expect(html).toContain(copy.feedNoteNotApproved);
  });

  it('the controls of a row follow its state: not reviewed, mapped and outside scope (04-ux checks 10 to 12)', async () => {
    await signIn();
    const [aceite] = await fiveTargets();
    const { feedId } = await aFeed();
    await productIn(feedId, 'Pendiente');
    await productIn(feedId, 'Asignada');
    await productIn(feedId, 'Fuera');
    await assignCategory(categoryForm({ feedId, feedCategory: 'Asignada', target: aceite.id }));
    const { markOutsideScope } = await import('@/server/admin/category-mappings');
    await markOutsideScope(categoryForm({ feedId, feedCategory: 'Fuera' }));

    const { html } = await render();

    const rowOf = (name: string) => {
      const start = html.indexOf(`data-testid="category-name">${name}<`);
      const end = html.indexOf('data-testid="category-row"', start + 1);
      return html.slice(start, end === -1 ? undefined : end);
    };
    const testIds = (row: string) => [...row.matchAll(/<button\b[^>]*data-testid="([^"]+)"/g)].map((match) => match[1]);
    expect(testIds(rowOf('Pendiente'))).toEqual(['category-assign', 'category-mark-outside']);
    expect(testIds(rowOf('Asignada'))).toEqual(['category-change', 'category-mark-outside', 'category-remove']);
    expect(testIds(rowOf('Fuera'))).toEqual(['category-assign', 'category-unmark']);
  });
});

describe('the rendered copy never promises publication (AC 47)', () => {
  it('says publication needs an approved feed and shop, no hidden flag and a category, and that a removal takes products off', async () => {
    await signIn();
    await aFeed();

    const { html } = await render();

    expect(html).toContain(copy.rulePublic);
    expect(html).toContain(copy.ruleRemove);
    expect(copy.rulePublic).toMatch(/no aprueba ningún feed ni ninguna tienda/);
    expect(copy.rulePublic).toMatch(/únicamente si su feed y su tienda están aprobados, no está oculto y tiene categoría/);
  });
});
