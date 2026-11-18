import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFeedAction,
  updateFeedAction,
  type SourceFormState,
} from '@/app/admin/(shell)/tiendas/actions';
import { closeDb, getDb } from '@/db/client';
import { feeds, networks } from '@/db/schema';
import { getFeedForEdit, listSourcesForAdmin } from '@/server/admin/sources';

import { SITE_ORIGIN, consoleMethods, createAdmin, signInForCookie } from '../support/admin';
import { assertTestDatabase, resetDatabase } from '../support/db';
import { insertFeed, insertShop } from '../support/catalogue';
import { redirectOf, startAdminRequest } from '../support/next-request';

// US-3.1 / T3.1.3, ACs 23 to 25, 28 and 29 (guardrail 5): a recognisable key planted in a
// feed address is found nowhere in captured output, in a returned state, in a rendered page,
// or in the data a page hands to a client component. Only the host may appear.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('use-intl/core');
  const messages = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'es-ES', messages, namespace } as never) as unknown,
  };
});

const KEY = 'KEY-SENTINEL-77e0b2';
const TOKEN = 'TOKEN-SENTINEL-19ac44';
const USER = 'USER-SENTINEL-6d31';
const PASS = 'PASS-SENTINEL-c0f8';
const SECRET_URL = `https://feeds.example:8443/private/${KEY}/catalogo.csv?apikey=${KEY}&token=${TOKEN}#frag-${KEY}`;
/** Every fragment of the address that must never show: the host is the only thing allowed through. */
const LEAKS = [KEY, TOKEN, 'apikey', 'token=', ':8443', '/private/', 'catalogo.csv', 'frag-', 'https://', 'https:'];
/** The same for a rendered page, whose own copy says "https://" in a hint: the scheme only counts in front of a host. */
const PAGE_LEAKS = [KEY, TOKEN, 'apikey', 'token=', ':8443', '/private/', 'catalogo.csv', 'frag-', 'https://feeds', 'https://upload', 'feeds.example/', 'upload.example/', 'feeds.example:', 'upload.example:'];

const IDLE: SourceFormState = { status: 'idle' };
let output: string[] = [];

function capture() {
  output = [];
  for (const method of consoleMethods) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    }) as never);
  }
}

/** In any case or encoding a log line might use. */
function expectNoSecret(text: string, label: string, extra: string[] = []) {
  const values = [KEY, TOKEN, USER, PASS, ...extra];
  const encodings = values.flatMap((value) => [
    value,
    value.toLowerCase(),
    value.toUpperCase(),
    encodeURIComponent(value),
    Buffer.from(value).toString('base64'),
    JSON.stringify(value),
  ]);
  for (const needle of encodings) expect(text, `${label} holds ${needle.slice(0, 8)}...`).not.toContain(needle);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(async () => {
  await resetDatabase();
  await createAdmin();
  capture();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

async function signIn() {
  const { cookie } = await signInForCookie();
  startAdminRequest({ cookie, origin: SITE_ORIGIN });
  return cookie;
}

async function planted() {
  const shop = await insertShop({ name: 'Tienda Secreta' });
  const [network] = await getDb().insert(networks).values({ name: 'Red Secreta', slug: 'red-secreta' }).returning({ id: networks.id });
  const [feed] = await getDb()
    .insert(feeds)
    .values({ shopId: shop.id, networkId: network.id, sourceType: 'affiliate_network', url: SECRET_URL, isApproved: true, isDemo: false })
    .returning({ id: feeds.id });
  const uploadId = await insertFeed(shop.id, { url: `https://${USER}:${PASS}@upload.example/f.csv?apikey=${KEY}`, isApproved: false });
  return { shop, network, feedId: feed.id, uploadId };
}

describe('the action path writes the key to no log (AC 28)', () => {
  it('on success, on a refusal and on a duplicate, for create and for edit', async () => {
    const { shop, network, feedId } = await planted();
    await signIn();
    const created = `https://feeds.example/nuevo.csv?apikey=${KEY}&token=${TOKEN}`;

    await redirectOf(() => createFeedAction(IDLE, form({ shopId: String(shop.id), networkId: String(network.id), url: created })));
    const duplicate = await createFeedAction(IDLE, form({ shopId: String(shop.id), networkId: String(network.id), url: created }));
    const refusedHttp = await createFeedAction(
      IDLE,
      form({ shopId: String(shop.id), networkId: String(network.id), url: `http://feeds.example/x?apikey=${KEY}` }),
    );
    const refusedCredentials = await createFeedAction(
      IDLE,
      form({ shopId: String(shop.id), networkId: String(network.id), url: `https://${USER}:${PASS}@feeds.example/x?apikey=${KEY}` }),
    );
    const tooLong = await createFeedAction(
      IDLE,
      form({ shopId: String(shop.id), networkId: String(network.id), url: `https://feeds.example/${KEY}${'a'.repeat(2100)}` }),
    );
    await redirectOf(() =>
      updateFeedAction(IDLE, form({ id: String(feedId), networkId: String(network.id), url: `https://feeds.example/rotada.csv?apikey=${KEY}` })),
    );
    const editRefused = await updateFeedAction(
      IDLE,
      form({ id: String(feedId), networkId: String(network.id), url: `https://${USER}:${PASS}@feeds.example/x` }),
    );

    expect([duplicate, refusedHttp, refusedCredentials, tooLong, editRefused].map((state) => state.status)).toEqual(Array(5).fill('refused'));
    expectNoSecret(output.join('\n'), 'the captured output');
  });

  it('on a write that fails, where the database error message itself carries the address', async () => {
    const { shop, network, feedId } = await planted();
    await signIn();
    await assertTestDatabase();
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_feed_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', new.url using errcode = 'P0001'; end $$"),
    );
    await db.execute(sql.raw('create trigger fail_feed_write before insert or update on feeds for each row execute function fail_feed_write()'));
    let states: SourceFormState[];
    try {
      states = [
        await createFeedAction(IDLE, form({ shopId: String(shop.id), networkId: String(network.id), url: `https://feeds.example/y?apikey=${KEY}` })),
        await updateFeedAction(IDLE, form({ id: String(feedId), networkId: String(network.id), url: `https://feeds.example/z?apikey=${KEY}` })),
      ];
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_feed_write on feeds'));
      await db.execute(sql.raw('drop function if exists fail_feed_write()'));
    }

    expect(states.map((state) => state.status)).toEqual(['failed', 'failed']);
    expect(output.filter((line) => line.includes('admin-sources'))).toEqual(['admin-sources: failed (P0001)', 'admin-sources: failed (P0001)']);
    expectNoSecret(output.join('\n'), 'the captured output');
    expectNoSecret(JSON.stringify(states), 'the returned states');
    // The stored address is intact: the failed edit changed nothing.
    const [row] = await db.select().from(feeds).where(sql`${feeds.id} = ${feedId}`);
    expect(row.url).toBe(SECRET_URL);
  });

  it('on the list and edit reads', async () => {
    const { feedId } = await planted();
    await signIn();
    await listSourcesForAdmin();
    await getFeedForEdit(feedId);
    expectNoSecret(output.join('\n'), 'the captured output');
  });
});

describe('the reads hand out the host and nothing else (AC 23, 25)', () => {
  it('the list and the edit read carry no part of the address', async () => {
    const { feedId, uploadId } = await planted();
    const list = await listSourcesForAdmin();
    const edit = await getFeedForEdit(feedId);
    const text = JSON.stringify([list, edit]);
    expect(text).toContain('feeds.example');
    expect(text).toContain('upload.example');
    for (const leak of [...LEAKS, USER, PASS]) expect(text, leak).not.toContain(leak);
    expect(list[0].feeds.map((feed) => [feed.id, feed.host])).toEqual([
      [feedId, 'feeds.example'],
      [uploadId, 'upload.example'],
    ]);
  });
});

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

describe('a rendered admin page and the data it hands to its client components (AC 23, 25, 26)', () => {
  it('the sources list shows the host, and no other part of any address, in its HTML or its props', async () => {
    await planted();
    await signIn();
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');

    const element = await SourcesPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(element);
    const props = propStrings(element).join('\n');

    for (const [label, text] of [['html', html], ['props', props]] as const) {
      expect(text, label).toContain('feeds.example');
      for (const leak of [...PAGE_LEAKS, USER, PASS]) expect(text, `${label} holds ${leak}`).not.toContain(leak);
    }
    expectNoSecret(html, 'the sources HTML');
    expectNoSecret(props, 'the sources props');
    expect(output.join('\n')).not.toContain('feeds.example');
  });

  it('the feed edit form shows the host as text, an empty address field, and the keep-it hint', async () => {
    const { feedId } = await planted();
    await signIn();
    const { default: EditFeedPage } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');

    const element = await EditFeedPage({ params: Promise.resolve({ id: String(feedId) }) });
    const html = renderToStaticMarkup(element);
    const props = propStrings(element).join('\n');

    expect(html).toContain('feeds.example');
    for (const text of [html, props]) {
      for (const leak of [...PAGE_LEAKS, USER, PASS]) expect(text, leak).not.toContain(leak);
    }
    const input = /<input\b[^>]*\bname="url"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).not.toBe('');
    expect(input).not.toMatch(/\bvalue=/);
    expect(html).toContain('Déjala vacía para conservar la URL actual.');
    // The warning of AC 21 stands above the field for an approved feed, before any script runs.
    expect(html).toContain('feed-warning');
    expect(html.indexOf('feed-warning')).toBeLessThan(html.indexOf('name="url"'));
    expectNoSecret(html, 'the edit form HTML');
  });

  it('the create form carries no address either, and a hidden input holds only the id', async () => {
    const { shop } = await planted();
    await signIn();
    const { default: NewFeedPage } = await import('@/app/admin/(shell)/tiendas/feed/nuevo/page');
    const element = await NewFeedPage({ searchParams: Promise.resolve({ tienda: String(shop.id) }) });
    const html = renderToStaticMarkup(element);
    const input = /<input\b[^>]*\bname="url"[^>]*>/.exec(html)?.[0] ?? '';
    expect(input).not.toMatch(/\bvalue=/);
    for (const hidden of html.match(/<input\b[^>]*type="hidden"[^>]*>/g) ?? []) {
      expect(hidden).not.toMatch(/https?:|apikey|KEY-SENTINEL/);
    }
    for (const leak of [...PAGE_LEAKS, USER, PASS]) expect(html, leak).not.toContain(leak);
  });

  it('a demo feed shows no address field and no stored value, the demo phrase in its place', async () => {
    const shop = await insertShop({ name: 'Tienda Demo Prueba' });
    const demoId = await insertFeed(shop.id, { url: 'demo-feed:feed-uno.csv', isDemo: true });
    const [network] = await getDb().insert(networks).values({ name: 'Red Demo', slug: 'red-d' }).returning({ id: networks.id });
    await getDb().update(feeds).set({ networkId: network.id, sourceType: 'affiliate_network' }).where(sql`${feeds.id} = ${demoId}`);
    await signIn();
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');
    const { default: EditFeedPage } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');

    const list = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));
    const edit = renderToStaticMarkup(await EditFeedPage({ params: Promise.resolve({ id: String(demoId) }) }));

    expect(list).not.toContain('demo-feed:');
    expect(edit).not.toContain('demo-feed:');
    expect(edit).not.toMatch(/\bname="url"/);
    expect(edit).toContain('feed-demo-hint');
    expect(edit).toContain('ninguno (demostración)');
  });

  it('is shown to catch a leak: a stored address that reached the props or the HTML would fail the checks above', () => {
    const element = createElement('div', { data: { url: SECRET_URL } }, createElement('input', { name: 'url', defaultValue: SECRET_URL }));
    expect(propStrings(element).join('\n')).toContain(KEY);
    expect(renderToStaticMarkup(element)).toContain(KEY);
  });
});
