import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeedAction, updateFeedAction, type SourceFormState } from '@/app/admin/(shell)/tiendas/actions';
import { closeDb, getDb } from '@/db/client';
import { feeds } from '@/db/schema';
import { listCategoryMappingsForAdmin } from '@/server/admin/category-mappings';
import { getFeedForEdit, listSourcesForAdmin } from '@/server/admin/sources';
import { signOutAction } from '@/server/auth/actions';

import messages from '../../messages/es-ES.json';
import { SITE_ORIGIN, consoleMethods, createAdmin, expireSessionRow, forge, signInForCookie } from '../support/admin';
import { insertFeed, insertShop } from '../support/catalogue';
import { insertFileFeed } from '../support/catalogue-files';
import { assertTestDatabase, resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// S3.7 T3.7.4. The two shipped feed actions on the catalogue-file source (ACs 5, 6, 7: no session,
// forged, expired, signed-out and cross-origin, with no effect), and what the admin pages and
// every log, state and client payload hold about a file feed (ACs 10 and 13, guardrail 5):
// its file name at most, never a path, a folder or a value the rule refuses. The writers
// themselves are in admin-source-writers.test.ts. Every name here is invented.

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
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    NextIntlClientProvider: (props: Record<string, unknown>) =>
      createElement(actual.NextIntlClientProvider as never, { locale: 'es-ES', ...props }),
  };
});

const IDLE: SourceFormState = { status: 'idle' };
const copy = messages.Admin.Sources;
/** A recognisable value for the leak checks: planted as a stored name, or typed into a form. */
const PLANTED_PATH = '..\\..\\secreto-plantado\\ruta.csv';
const PLANTED_ABSOLUTE = 'C:\\Users\\plantado\\catalogo-secreto.csv';
const TYPED_PATH = '../escrito-a-mano/otro-secreto.csv';
const FOLDER = 'catalogue-files';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

async function signedIn(): Promise<{ cookie: string; token: string }> {
  await createAdmin();
  return signInForCookie();
}

async function world() {
  const shop = await insertShop({ name: 'Tienda Archivo', isApproved: true });
  const feedId = await insertFileFeed(shop.id, 'existente.csv', { isApproved: true });
  return { shop, feedId };
}

async function snapshot() {
  return getDb().select().from(feeds).orderBy(feeds.id);
}

/** Every string a page element hands down in props, children included: what a client component would be sent. */
function propStrings(node: ReactNode | unknown, seen = new Set<unknown>()): string[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'function') return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (typeof node !== 'object' || seen.has(node)) return [];
  seen.add(node);
  if (Array.isArray(node)) return node.flatMap((child) => propStrings(child, seen));
  if (isValidElement(node)) return propStrings((node as { props: unknown }).props, seen);
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => [key, ...propStrings(value, seen)]);
}

type Call = { name: string; action: (previous: SourceFormState, data: FormData) => Promise<SourceFormState>; fields: Record<string, string> };

async function fileCalls(): Promise<{ calls: Call[]; feedId: number }> {
  const { shop, feedId } = await world();
  return {
    feedId,
    calls: [
      { name: 'createFeedAction', action: createFeedAction, fields: { source: 'catalogue_file', shopId: String(shop.id), fileName: 'nuevo.csv' } },
      { name: 'updateFeedAction', action: updateFeedAction, fields: { id: String(feedId), fileName: 'renombrado.csv' } },
    ],
  };
}

const NAMES = ['createFeedAction', 'updateFeedAction'];

describe('a file feed action with no valid session is refused before the form is read, and writes nothing (AC 5)', () => {
  it.each(NAMES)('%s: no cookie, a forged, an expired and a signed-out cookie redirect to sign-in', async (name) => {
    const { calls } = await fileCalls();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await snapshot();
    const live = await signedIn();
    const expired = await signInForCookie();
    await expireSessionRow(expired.token);
    const out = await signInForCookie();
    startAdminRequest({ cookie: out.cookie, origin: SITE_ORIGIN });
    await redirectOf(() => signOutAction());

    for (const cookie of [undefined, 'admin.session_token=forged.value', forge(live.cookie), expired.cookie, out.cookie]) {
      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      const untouched = { get: vi.fn(() => { throw new Error('form read before the role check'); }) } as unknown as FormData;
      expect(await redirectOf(() => action(IDLE, untouched)), String(cookie)).toBe('/admin/acceso?aviso=sesion');
      expect(untouched.get).not.toHaveBeenCalled();
      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      expect(await redirectOf(() => action(IDLE, form(fields)))).toBe('/admin/acceso?aviso=sesion');
      expect(nextRequest.cookieWrites).toEqual([]);
    }
    expect(await snapshot()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a file feed submitted from another origin is refused and writes nothing (AC 6)', () => {
  it.each(NAMES)('%s: another origin, the string null and no origin return failed, repeat nothing and log the refusal', async (name) => {
    const { calls } = await fileCalls();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await snapshot();
    const { cookie } = await signedIn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3001', null]) {
      startAdminRequest({ cookie, origin });
      const state = await action(IDLE, form({ ...fields, fileName: TYPED_PATH }));
      expect(state.status, String(origin)).toBe('failed');
      expect(JSON.stringify(state)).not.toContain('escrito-a-mano');
    }

    expect(await snapshot()).toEqual(before);
    expect(errors.mock.calls.map((call) => call.join(' '))).toEqual(Array(4).fill('admin-sources: refused (ORIGIN)'));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a signed-in file feed submission writes what the form offers and nothing else (AC 7)', () => {
  it('creates an unapproved, non-demo feed with no network, and redirects to the fixed notice', async () => {
    const { calls } = await fileCalls();
    const { action, fields } = calls.find((call) => call.name === 'createFeedAction')!;
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const to = await redirectOf(() =>
      action(IDLE, form({ ...fields, isApproved: 'true', isDemo: 'true', sourceType: 'shop_upload', networkId: '1', url: 'https://tienda.example/x.csv' })),
    );

    expect(to).toBe('/admin/tiendas?aviso=feed-creado');
    expect(to).not.toContain('nuevo.csv');
    const created = (await snapshot()).find((row) => row.url === 'nuevo.csv');
    expect(created).toMatchObject({ isApproved: false, isDemo: false, networkId: null, sourceType: 'catalogue_file' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/tiendas');
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('a rename of an approved feed redirects to the unapproved notice, the same name to the plain saved notice', async () => {
    const { feedId } = await fileCalls();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await redirectOf(() => updateFeedAction(IDLE, form({ id: String(feedId), fileName: 'existente.csv' })))).toBe('/admin/tiendas?aviso=feed-guardado');
    expect((await snapshot())[0]).toMatchObject({ url: 'existente.csv', isApproved: true });
    expect(await redirectOf(() => updateFeedAction(IDLE, form({ id: String(feedId), fileName: 'otro.csv', shopId: '999', isApproved: 'true', source: 'affiliate_network' })))).toBe(
      '/admin/tiendas?aviso=feed-sin-aprobar',
    );
    expect((await snapshot())[0]).toMatchObject({ url: 'otro.csv', isApproved: false, sourceType: 'catalogue_file', networkId: null });
  });

  it('a refusal comes back with the error code and never the name, a path or a value the rule refuses', async () => {
    const { shop } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const state = await createFeedAction(IDLE, form({ source: 'catalogue_file', shopId: String(shop.id), fileName: TYPED_PATH, name: 'Un nombre' }));

    expect(state).toMatchObject({ status: 'refused', errors: { fileName: 'not_a_name' } });
    expect(JSON.stringify(state)).not.toMatch(/escrito-a-mano|otro-secreto|\.csv/);
    const duplicate = await createFeedAction(IDLE, form({ source: 'catalogue_file', shopId: String(shop.id), fileName: 'existente.csv' }));
    expect(duplicate).toMatchObject({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(JSON.stringify(duplicate)).not.toContain('existente');
  });
});

describe('the file feed leaves no path, folder or planted value in a log, a state or a rendered page (AC 10, 13)', () => {
  let output: string[] = [];
  function capture() {
    output = [];
    for (const method of consoleMethods) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
  }
  const NEEDLES = ['secreto-plantado', 'catalogo-secreto', 'plantado', 'escrito-a-mano', 'otro-secreto', FOLDER];

  async function planted() {
    const shop = await insertShop({ name: 'Tienda Plantada' });
    const good = await insertFileFeed(shop.id, 'visible.csv');
    const traversal = await insertFileFeed(shop.id, PLANTED_PATH, { isApproved: false });
    const absolute = await insertFileFeed(shop.id, PLANTED_ABSOLUTE, { isApproved: false });
    return { shop, good, traversal, absolute };
  }

  it('the reads return the valid name, and null for a stored value that is not a name', async () => {
    const { good, traversal, absolute } = await planted();

    const [shop] = await listSourcesForAdmin();
    const byId = new Map(shop.feeds.map((feed) => [feed.id, feed]));

    expect(byId.get(good)).toMatchObject({ source: 'catalogue_file', fileName: 'visible.csv', host: null, networkName: null });
    for (const id of [traversal, absolute]) expect(byId.get(id)).toMatchObject({ source: 'catalogue_file', fileName: null, host: null });
    const text = JSON.stringify([await listSourcesForAdmin(), await listCategoryMappingsForAdmin(), await getFeedForEdit(traversal), await getFeedForEdit(good)]);
    for (const needle of NEEDLES) expect(text, needle).not.toContain(needle);
  });

  it('the feeds list names a file feed by its file name, not as an upload, a network feed or a host, and shows no path', async () => {
    await planted();
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');

    const element = await SourcesPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    const props = propStrings(element).join('\n');

    expect(html).toContain(copy.fileLabel);
    expect(html).toContain('visible.csv');
    expect(html).toContain(copy.fileUnavailable);
    expect(html).toContain(copy.feedMetaFile);
    expect(html).not.toContain(copy.feedMetaUpload);
    expect(html).not.toContain(copy.domainLabel);
    for (const text of [html, props]) for (const needle of NEEDLES) expect(text, needle).not.toContain(needle);
  });

  it('the category screen shows the same identity and never the "Subido por la tienda" fallback', async () => {
    await planted();
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: Page } = await import('@/app/admin/(shell)/categorias/page');

    const element = await Page();
    const html = renderToStaticMarkup(element as never);
    const payload = JSON.stringify(element);

    expect(html).toContain(copy.fileLabel);
    expect(html).toContain('visible.csv');
    expect(html).toContain(copy.fileUnavailable);
    expect(html).toContain(copy.feedMetaFile);
    expect(html).not.toContain(copy.feedMetaUpload);
    expect(html).not.toContain(copy.domainLabel);
    expect(html).toContain(messages.Admin.Categories.feedNeverImportedFile);
    for (const text of [html, payload]) for (const needle of NEEDLES) expect(text, needle).not.toContain(needle);
  });

  it('the edit page of a file feed prefills the stored name, and shows no field value for a stored path', async () => {
    const { good, traversal } = await planted();
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: EditFeedPage } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');

    const ok = renderToStaticMarkup(await EditFeedPage({ params: Promise.resolve({ id: String(good) }) }));
    const odd = renderToStaticMarkup(await EditFeedPage({ params: Promise.resolve({ id: String(traversal) }) }));

    expect(ok).toMatch(/\bname="fileName"[^>]*\bvalue="visible\.csv"|\bvalue="visible\.csv"[^>]*\bname="fileName"/);
    expect(ok).not.toMatch(/\bname="(url|networkId)"/);
    for (const needle of NEEDLES) expect(odd, needle).not.toContain(needle);
    expect(odd).not.toMatch(/\bvalue="[^"]*\.csv"/);
  });

  it('the actions log nothing for a success, a refusal or a duplicate, and nothing holds the typed value', async () => {
    const { shop } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    capture();

    await redirectOf(() => createFeedAction(IDLE, form({ source: 'catalogue_file', shopId: String(shop.id), fileName: 'escrito-a-mano.csv' })));
    const duplicate = await createFeedAction(IDLE, form({ source: 'catalogue_file', shopId: String(shop.id), fileName: 'escrito-a-mano.csv' }));
    const refused = await createFeedAction(IDLE, form({ source: 'catalogue_file', shopId: String(shop.id), fileName: TYPED_PATH }));

    expect([duplicate.status, refused.status]).toEqual(['refused', 'refused']);
    expect(output).toEqual([]);
  });

  it('a write that fails returns failed and logs a code only, though the database message carries the name', async () => {
    const { shop, feedId } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    capture();
    await assertTestDatabase();
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_feed_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', new.url using errcode = 'P0001'; end $$"),
    );
    await db.execute(sql.raw('create trigger fail_feed_write before insert or update on feeds for each row execute function fail_feed_write()'));
    let states: SourceFormState[];
    try {
      states = [
        await createFeedAction(IDLE, form({ source: 'catalogue_file', shopId: String(shop.id), fileName: 'escrito-a-mano.csv' })),
        await updateFeedAction(IDLE, form({ id: String(feedId), fileName: 'otro-secreto.csv' })),
      ];
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_feed_write on feeds'));
      await db.execute(sql.raw('drop function if exists fail_feed_write()'));
    }

    expect(states.map((state) => state.status)).toEqual(['failed', 'failed']);
    expect(output).toEqual(['admin-sources: failed (P0001)', 'admin-sources: failed (P0001)']);
    expect(JSON.stringify([states, output])).not.toMatch(/escrito-a-mano|otro-secreto|boom/);
    expect((await snapshot()).map((row) => row.url)).toEqual(['existente.csv']);
  });

  it('is shown to catch a leak: a stored path that reached the props or the HTML would fail the checks above', () => {
    const element = createElement('div', { data: { url: PLANTED_PATH } }, createElement('input', { name: 'fileName', defaultValue: PLANTED_PATH }));
    expect(propStrings(element).join('\n')).toContain('secreto-plantado');
    expect(renderToStaticMarkup(element)).toContain('secreto-plantado');
  });
});

describe('a file feed and an https feed stay apart in the lists', () => {
  it('an https feed on the same shop still shows its host and its network line, a file feed does not', async () => {
    const shop = await insertShop({ name: 'Tienda Mixta' });
    await insertFeed(shop.id, { url: 'https://feeds.example/mixta.csv', isApproved: false });
    await insertFileFeed(shop.id, 'mixta.csv', { isApproved: false });

    const [listed] = await listSourcesForAdmin();

    expect(listed.feeds.map((feed) => [feed.source, feed.host, feed.fileName])).toEqual([
      ['shop_upload', 'feeds.example', null],
      ['catalogue_file', null, 'mixta.csv'],
    ]);
  });
});
