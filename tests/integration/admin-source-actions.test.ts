import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFeedAction,
  createNetworkAction,
  createShopAction,
  updateFeedAction,
  updateNetworkAction,
  updateShopAction,
  type SourceFormState,
} from '@/app/admin/(shell)/tiendas/actions';
import { closeDb, getDb } from '@/db/client';
import { feeds, networks, shops } from '@/db/schema';
import { setFeedApproval, setShopApproval } from '@/server/admin/sources';
import { signOutAction } from '@/server/auth/actions';

import { SITE_ORIGIN, createAdmin, expireSessionRow, forge, signInForCookie } from '../support/admin';
import { assertTestDatabase, resetDatabase } from '../support/db';
import { insertShop } from '../support/catalogue';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// US-3.1 / T3.1.3, ACs 1 to 5 and 25: the six actions this story adds refuse a request with
// no session, a forged, an expired or a signed-out cookie, and one from another origin, and
// then write nothing and set no cookie (guardrail 3). A signed-in call writes what the form
// allows, redirects to a fixed notice key, and returns a state that never holds the address.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Action = (previous: SourceFormState, form: FormData) => Promise<SourceFormState>;
const IDLE: SourceFormState = { status: 'idle' };
const KEY = 'KEY-SENTINEL-a41c';

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

async function snapshot() {
  const db = getDb();
  return {
    networks: await db.select().from(networks).orderBy(networks.id),
    shops: await db.select().from(shops).orderBy(shops.id),
    feeds: await db.select().from(feeds).orderBy(feeds.id),
  };
}

/** What the world holds for the actions to edit, and one valid submission for each of the six. */
async function world() {
  const [network] = await getDb().insert(networks).values({ name: 'Red Uno', slug: 'red-uno' }).returning({ id: networks.id });
  const shop = await insertShop({ slug: 'tienda-uno', name: 'Tienda Uno', isApproved: false });
  const [feed] = await getDb()
    .insert(feeds)
    .values({
      shopId: shop.id,
      networkId: network.id,
      sourceType: 'affiliate_network',
      url: `https://feeds.example/uno.csv?apikey=${KEY}`,
      isApproved: true,
      isDemo: false,
    })
    .returning({ id: feeds.id });
  const calls: { name: string; action: Action; fields: Record<string, string>; notice: string }[] = [
    { name: 'createNetworkAction', action: createNetworkAction, fields: { name: 'Red Dos', slug: 'red-dos' }, notice: 'red-creada' },
    { name: 'updateNetworkAction', action: updateNetworkAction, fields: { id: String(network.id), name: 'Red Renombrada' }, notice: 'red-guardada' },
    { name: 'createShopAction', action: createShopAction, fields: { name: 'Tienda Dos', slug: 'tienda-dos' }, notice: 'tienda-creada' },
    { name: 'updateShopAction', action: updateShopAction, fields: { id: String(shop.id), name: 'Tienda Renombrada' }, notice: 'tienda-guardada' },
    {
      name: 'createFeedAction',
      action: createFeedAction,
      fields: { shopId: String(shop.id), networkId: String(network.id), url: 'https://feeds.example/dos.csv' },
      notice: 'feed-creado',
    },
    {
      name: 'updateFeedAction',
      action: updateFeedAction,
      fields: { id: String(feed.id), networkId: String(network.id), url: 'https://feeds.example/nuevo.csv' },
      notice: 'feed-sin-aprobar',
    },
  ];
  return { network, shop, feedId: feed.id, calls };
}

async function signedIn(): Promise<{ cookie: string; token: string }> {
  await createAdmin();
  return signInForCookie();
}

const NAMES = ['createNetworkAction', 'updateNetworkAction', 'createShopAction', 'updateShopAction', 'createFeedAction', 'updateFeedAction'];

describe('a request with no valid session is refused before the form is read, and writes nothing (AC 1)', () => {
  it.each(NAMES)('%s: no cookie, a forged cookie, an expired one and a signed-out one redirect to sign-in', async (name) => {
    const { calls } = await world();
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
      // A form whose every read throws: the role check must answer before anything is read.
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

  it.each(NAMES)('%s: with the session check unavailable it returns failed and writes nothing', async (name) => {
    const { calls } = await world();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    vi.stubEnv('AUTH_SECRET', 'short');

    const state = await action(IDLE, form(fields));

    expect(state.status).toBe('failed');
    vi.unstubAllEnvs();
    expect(await snapshot()).toEqual(before);
  });
});

describe('a submission from another origin is refused and writes nothing (AC 2)', () => {
  it.each(NAMES)('%s: another origin, the string null and no origin all return failed and log the refusal', async (name) => {
    const { calls } = await world();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await snapshot();
    const { cookie } = await signedIn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3001', null]) {
      startAdminRequest({ cookie, origin });
      const state = await action(IDLE, form({ ...fields, url: `https://feeds.example/x?apikey=${KEY}` }));
      expect(state.status, String(origin)).toBe('failed');
      expect(JSON.stringify(state)).not.toContain(KEY);
    }

    expect(await snapshot()).toEqual(before);
    expect(errors.mock.calls.map((call) => call.join(' '))).toEqual(Array(4).fill('admin-sources: refused (ORIGIN)'));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(nextRequest.cookieWrites).toEqual([]);
  });
});

describe('a signed-in call from the site origin writes what the form allows (AC 3, 43)', () => {
  it.each(NAMES)('%s: writes, revalidates the list and redirects to its fixed notice', async (name) => {
    const { calls } = await world();
    const { action, fields, notice } = calls.find((call) => call.name === name)!;
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await redirectOf(() => action(IDLE, form(fields)))).toBe(`/admin/tiendas?aviso=${notice}`);

    expect(await snapshot()).not.toEqual(before);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/tiendas');
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('the redirect target carries no name, slug or address, only the notice key', async () => {
    const { feedId, network } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const to = await redirectOf(() =>
      updateFeedAction(IDLE, form({ id: String(feedId), networkId: String(network.id), url: `https://feeds.example/x?apikey=${KEY}` })),
    );
    expect(to).toBe('/admin/tiendas?aviso=feed-sin-aprobar');
    expect(to).not.toMatch(/KEY|feeds|apikey|Red|Tienda/);
  });

  it('saving a feed without a new address, or with one on an unapproved feed, redirects to the plain saved notice', async () => {
    const { feedId, network } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    expect(await redirectOf(() => updateFeedAction(IDLE, form({ id: String(feedId), networkId: String(network.id), url: '' })))).toBe(
      '/admin/tiendas?aviso=feed-guardado',
    );
    await setFeedApproval(feedId, false);
    expect(
      await redirectOf(() =>
        updateFeedAction(IDLE, form({ id: String(feedId), networkId: String(network.id), url: 'https://feeds.example/otro.csv' })),
      ),
    ).toBe('/admin/tiendas?aviso=feed-guardado');
  });

  it('a created shop and a created feed are unapproved, whatever a crafted request adds (AC 4)', async () => {
    const { network, shop } = await world();
    await setShopApproval(shop.id, true);
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    await redirectOf(() => createShopAction(IDLE, form({ name: 'Nueva', slug: 'nueva', isApproved: 'true', isDemo: 'true' })));
    await redirectOf(() =>
      createFeedAction(
        IDLE,
        form({
          shopId: String(shop.id),
          networkId: String(network.id),
          url: 'https://feeds.example/nuevo.csv',
          isApproved: 'true',
          isDemo: 'true',
          sourceType: 'shop_upload',
        }),
      ),
    );

    const now = await snapshot();
    expect(now.shops.find((row) => row.slug === 'nueva')).toMatchObject({ isApproved: false });
    expect(now.feeds.find((row) => row.url === 'https://feeds.example/nuevo.csv')).toMatchObject({
      isApproved: false,
      isDemo: false,
      sourceType: 'affiliate_network',
    });
  });
});

describe('a refused submission comes back with the values and never the address (AC 25, 27)', () => {
  it('echoes the name, slug and well-formed ids, and nothing of the address or any other field', async () => {
    const { network, shop } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const state = await createFeedAction(
      IDLE,
      form({
        shopId: String(shop.id),
        networkId: String(network.id),
        url: `http://feeds.example/x?apikey=${KEY}`,
        name: 'Un nombre',
        slug: 'un-slug',
        password: 'PW-SENTINEL',
        isApproved: 'true',
      }),
    );

    expect(state).toEqual({
      status: 'refused',
      errors: { url: 'invalid' },
      values: { name: 'Un nombre', slug: 'un-slug', shopId: String(shop.id), networkId: String(network.id) },
    });
    expect(JSON.stringify(state)).not.toMatch(/KEY|apikey|feeds\.example|PW-SENTINEL|isApproved/);
  });

  it('does not echo a malformed or out-of-range id', async () => {
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    for (const bad of ['abc', '0', '-3', '1.5', '2147483648', ' 7']) {
      const state = await createFeedAction(IDLE, form({ shopId: bad, networkId: bad, url: 'https://feeds.example/x' }));
      expect(state, bad).toMatchObject({ status: 'refused', values: {} });
      expect((state as { values: object }).values).toEqual({});
    }
  });

  it('refuses a duplicate address on create and on edit without repeating it', async () => {
    const { network, shop, feedId } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const same = `https://feeds.example/uno.csv?apikey=${KEY}`;
    const created = await createFeedAction(IDLE, form({ shopId: String(shop.id), networkId: String(network.id), url: same }));
    expect(created).toMatchObject({ status: 'refused', errors: { url: 'duplicate' } });
    await redirectOf(() => createFeedAction(IDLE, form({ shopId: String(shop.id), networkId: String(network.id), url: 'https://feeds.example/dos.csv' })));
    const edited = await updateFeedAction(IDLE, form({ id: String(feedId), networkId: String(network.id), url: 'https://feeds.example/dos.csv' }));
    expect(edited).toMatchObject({ status: 'refused', errors: { url: 'duplicate' } });
    expect(JSON.stringify([created, edited])).not.toMatch(/KEY|apikey|feeds\.example/);
  });

  it('logs nothing for a validation refusal', async () => {
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    await createNetworkAction(IDLE, form({ name: '', slug: 'A' }));
    await createFeedAction(IDLE, form({ url: `http://x.example/?k=${KEY}` }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('an edit of an id no row has returns failed, keeps the typed values and writes nothing', async () => {
    await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    for (const [action, fields] of [
      [updateNetworkAction, { id: '2000000000', name: 'Otro' }],
      [updateShopAction, { id: '2000000000', name: 'Otro' }],
      [updateFeedAction, { id: '2000000000', networkId: '1', url: `https://feeds.example/x?apikey=${KEY}` }],
    ] as const) {
      const state = await action(IDLE, form(fields));
      expect(state.status).toBe('failed');
      expect(JSON.stringify(state)).not.toMatch(/KEY|apikey|feeds\.example/);
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('a write that throws returns failed and logs a code only (AC 28, 29)', () => {
  it.each(NAMES)('%s: the state is failed, the log line is the fixed prefix and the code, nothing is written', async (name) => {
    const { calls } = await world();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const lines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
    await assertTestDatabase();
    const db = getDb();
    // Every write to the three tables fails with a message that carries the new address: a leak shows up in the log.
    await db.execute(
      sql.raw(
        "create function fail_source_write() returns trigger language plpgsql as $$ begin raise exception 'boom % %', new.name, coalesce(to_jsonb(new)->>'url', '') using errcode = 'P0001'; end $$",
      ),
    );
    for (const table of ['networks', 'shops']) {
      await db.execute(sql.raw(`create trigger fail_source_write before insert or update on ${table} for each row execute function fail_source_write()`));
    }
    await db.execute(
      sql.raw(
        "create function fail_feed_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', new.url using errcode = 'P0001'; end $$",
      ),
    );
    await db.execute(sql.raw('create trigger fail_feed_write before insert or update on feeds for each row execute function fail_feed_write()'));
    let state: SourceFormState;
    try {
      state = await action(IDLE, form(fields.url ? { ...fields, url: `https://feeds.example/y?apikey=${KEY}` } : fields));
    } finally {
      for (const table of ['networks', 'shops']) await db.execute(sql.raw(`drop trigger if exists fail_source_write on ${table}`));
      await db.execute(sql.raw('drop trigger if exists fail_feed_write on feeds'));
      await db.execute(sql.raw('drop function if exists fail_source_write()'));
      await db.execute(sql.raw('drop function if exists fail_feed_write()'));
    }

    expect(state.status).toBe('failed');
    expect(JSON.stringify(state)).not.toMatch(/KEY|apikey|boom/);
    expect(lines).toEqual(['admin-sources: failed (P0001)']);
    expect(await snapshot()).toEqual(before);
  });
});
