import { revalidatePath } from 'next/cache';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assignCategoryAction,
  markOutsideScopeAction,
  removeCategoryMappingAction,
} from '@/app/admin/(shell)/categorias/actions';
import { closeDb, getDb } from '@/db/client';
import { offers } from '@/db/schema';
import { type CategoryActionState } from '@/server/admin/category-mappings';
import { signOutAction } from '@/server/auth/actions';

import { SITE_ORIGIN, consoleMethods, createAdmin, expireSessionRow, forge, signInForCookie } from '../support/admin';
import {
  aFeed,
  allRecords,
  categoryBySlug,
  categoryForm,
  fiveTargets,
  productIn,
  rootCategory,
  rowsApartFromCategory,
  withFailingProductUpdates,
} from '../support/categories';
import { resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// S4.2 (T4.2.3), ACs 1 to 8, 45 and 49 on the three actions: the role check comes before the
// form is read, another origin is refused, the target is one of the five, a crafted request
// cannot set anything the screen does not offer, and a failure leaves a code and nothing else.
// The effect on products is in category-mapping-writer.test.ts.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Action = (previous: CategoryActionState, form: FormData) => Promise<CategoryActionState>;
const IDLE: CategoryActionState = { status: 'idle' };
const KEY = 'KEY-SENTINEL-77d2';
const CAT = 'Filtros';

const ACTIONS: [string, Action][] = [
  ['assignCategoryAction', assignCategoryAction],
  ['markOutsideScopeAction', markOutsideScopeAction],
  ['removeCategoryMappingAction', removeCategoryMappingAction],
];

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

/** A feed carrying one category on one product, whose address holds a planted key, plus the submission that names it. */
async function world() {
  const [aceite] = await fiveTargets();
  const { feedId } = await aFeed({ url: `https://feeds.example/uno.csv?apikey=${KEY}` });
  const product = await productIn(feedId, CAT);
  return { aceite, feedId, product, fields: { feedId, feedCategory: CAT, target: aceite.id } };
}

async function snapshot() {
  return { records: await allRecords(), categories: await categoryBySlug(), rows: await rowsApartFromCategory() };
}

function capture(): string[] {
  const lines: string[] = [];
  for (const method of consoleMethods) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  return lines;
}

describe('a request with no valid session is refused before the form is read, and writes nothing (AC 2)', () => {
  it.each(ACTIONS)('%s: no cookie, a forged, an expired and a signed-out cookie redirect to sign-in', async (_name, action) => {
    const { fields } = await world();
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
      const untouched = {
        get: vi.fn(() => {
          throw new Error('form read before the role check');
        }),
      } as unknown as FormData;
      expect(await redirectOf(() => action(IDLE, untouched)), String(cookie)).toBe('/admin/acceso?aviso=sesion');
      expect(untouched.get).not.toHaveBeenCalled();

      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      expect(await redirectOf(() => action(IDLE, categoryForm(fields)))).toBe('/admin/acceso?aviso=sesion');
      expect(nextRequest.cookieWrites).toEqual([]);
    }

    expect(await snapshot()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s: with the session check unavailable it returns failed and writes nothing', async (_name, action) => {
    const { fields } = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    vi.stubEnv('AUTH_SECRET', 'short');

    const state = await action(IDLE, categoryForm(fields));

    expect(state.status).toBe('failed');
    vi.unstubAllEnvs();
    expect(await snapshot()).toEqual(before);
  });
});

describe('a submission from another origin is refused and writes nothing (AC 3)', () => {
  it.each(ACTIONS)('%s: another origin, the string null and no origin all return failed and log only the refusal', async (_name, action) => {
    const { fields } = await world();
    const before = await snapshot();
    const { cookie } = await signedIn();
    const lines = capture();

    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3001', null]) {
      startAdminRequest({ cookie, origin });
      const state = await action(IDLE, categoryForm(fields));
      expect(state.status, String(origin)).toBe('failed');
      expect(JSON.stringify(state)).not.toContain(KEY);
    }

    expect(await snapshot()).toEqual(before);
    expect(lines).toEqual(Array(4).fill('admin-categories: refused (ORIGIN)'));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(nextRequest.cookieWrites).toEqual([]);
  });
});

describe('a signed-in call from the site origin saves, and revalidates only the admin screen (AC 18 to 21, 49)', () => {
  it('assigns, marks outside scope and removes through the three actions, with a state the screen can word', async () => {
    const { aceite, feedId, product, fields } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const mapped = await assignCategoryAction(IDLE, categoryForm(fields));
    expect(mapped).toMatchObject({
      status: 'saved',
      feedId,
      feedCategory: CAT,
      previous: { kind: 'not_reviewed' },
      stored: { kind: 'mapped', targetId: aceite.id, targetName: aceite.name },
      productsChanged: 1,
    });
    expect((await categoryBySlug())[product.slug]).toBe(aceite.id);

    const again = await assignCategoryAction(IDLE, categoryForm(fields));
    expect(again).toMatchObject({ status: 'unchanged', stored: { kind: 'mapped', targetId: aceite.id } });

    const marked = await markOutsideScopeAction(IDLE, categoryForm({ feedId, feedCategory: CAT }));
    expect(marked).toMatchObject({ status: 'saved', stored: { kind: 'outside' }, productsChanged: 1 });

    const removed = await removeCategoryMappingAction(IDLE, categoryForm({ feedId, feedCategory: CAT }));
    expect(removed).toMatchObject({ status: 'saved', stored: { kind: 'not_reviewed' }, productsChanged: null });

    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(vi.mocked(revalidatePath).mock.calls.every((call) => call[0] === '/admin/categorias')).toBe(true);
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('answers a refusal or an unchanged state without revalidating, and never holds the feed address', async () => {
    const { feedId, fields } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const states = [
      await assignCategoryAction(IDLE, categoryForm({ ...fields, target: '' })),
      await removeCategoryMappingAction(IDLE, categoryForm({ feedId, feedCategory: CAT })),
      await assignCategoryAction(IDLE, categoryForm({ ...fields, feedCategory: 'No existe' })),
    ];

    expect(states.map((state) => state.status)).toEqual(['refused', 'unchanged', 'refused']);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(JSON.stringify(states)).not.toMatch(/KEY|apikey|feeds\.example/);
  });
});

describe('a target is accepted only if it is one of the five (AC 4)', () => {
  it('accepts each of the five', async () => {
    const targets = await fiveTargets();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    for (const target of targets) {
      const { feedId } = await aFeed();
      await productIn(feedId, CAT);
      const state = await assignCategoryAction(IDLE, categoryForm({ feedId, feedCategory: CAT, target: target.id }));
      expect(state, target.slug).toMatchObject({ status: 'saved', stored: { kind: 'mapped', targetId: target.id } });
    }
  });

  it('refuses the root, a missing id and a value that is not a whole number, and writes nothing', async () => {
    const { fields } = await world();
    const root = await rootCategory();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const invalid = [String(root.id), '2000000000', 'abc', '1.5', '-1', '0', ' 7', '2147483648', '1e3', '0x10'];
    for (const target of invalid) {
      const state = await assignCategoryAction(IDLE, categoryForm({ ...fields, target }));
      expect(state, target).toMatchObject({ status: 'refused', reason: 'target_invalid' });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('answers target_required for an empty or absent target, and writes nothing', async () => {
    const { feedId } = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await assignCategoryAction(IDLE, categoryForm({ feedId, feedCategory: CAT, target: '' }))).toMatchObject({
      status: 'refused',
      reason: 'target_required',
    });
    expect(await assignCategoryAction(IDLE, categoryForm({ feedId, feedCategory: CAT }))).toMatchObject({
      status: 'refused',
      reason: 'target_required',
    });
    expect(await snapshot()).toEqual(before);
  });

  it('does not need a target to mark outside scope or to remove, and ignores one if sent', async () => {
    const { feedId, aceite } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    expect(await markOutsideScopeAction(IDLE, categoryForm({ feedId, feedCategory: CAT, target: aceite.id }))).toMatchObject({
      status: 'saved',
      stored: { kind: 'outside' },
    });
    expect((await allRecords())[0].categoryId).toBeNull();
  });
});

describe('a crafted submission cannot set anything the screen does not offer (AC 5)', () => {
  it('writes the one record and the categories, and ignores every other field', async () => {
    const { feedId, aceite, product, fields } = await world();
    const before = await rowsApartFromCategory();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const state = await assignCategoryAction(
      IDLE,
      categoryForm({
        ...fields,
        productId: product.id,
        categoryId: 1,
        category_id: 1,
        isHidden: 'true',
        is_hidden: 'true',
        isApproved: 'true',
        inReview: 'true',
        isDemo: 'true',
        slug: 'otro-slug',
        title: 'Otro titulo',
        url: 'https://evil.example/',
        intent: 'remove',
        shopId: 999,
      }),
    );

    expect(state).toMatchObject({ status: 'saved', stored: { kind: 'mapped', targetId: aceite.id } });
    expect(await allRecords()).toMatchObject([{ feedId, feedCategory: CAT, categoryId: aceite.id }]);
    expect((await categoryBySlug())[product.slug]).toBe(aceite.id);
    expect(await rowsApartFromCategory()).toEqual(before);
  });

  it('cannot reach a product by name: a form with only a product id writes nothing', async () => {
    const { product } = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    for (const [, action] of ACTIONS) {
      const state = await action(IDLE, categoryForm({ productId: product.id, categoryId: 1, target: 1 }));
      expect(state.status).toBe('refused');
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('a submission naming a feed or a category the screen would not list is refused (AC 6, 7, 8)', () => {
  it.each(ACTIONS)('%s: a feed that does not exist is refused with nothing written', async (_name, action) => {
    const { fields } = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    for (const feedId of ['2000000000', '0', '-1', 'abc', '1.5', '']) {
      const state = await action(IDLE, categoryForm({ ...fields, feedId }));
      expect(state, feedId).toMatchObject({ status: 'refused', reason: 'gone' });
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(ACTIONS)('%s: an empty or blank feed category is refused with nothing written', async (_name, action) => {
    const { fields } = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    for (const feedCategory of ['', ' ', '   ', '\t', ' \n ']) {
      const state = await action(IDLE, categoryForm({ ...fields, feedCategory }));
      expect(state, JSON.stringify(feedCategory)).toMatchObject({ status: 'refused', reason: 'gone', feedCategory: null });
    }
    expect(await action(IDLE, categoryForm({ feedId: fields.feedId, target: fields.target }))).toMatchObject({ status: 'refused', reason: 'gone' });
    expect(await snapshot()).toEqual(before);
  });

  it.each(ACTIONS)('%s: a category the feed does not carry, in any case, is refused with nothing written', async (_name, action) => {
    const { fields } = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    for (const feedCategory of ['No existe', 'filtros', 'FILTROS', 'Filtro', 'Filtros >']) {
      const state = await action(IDLE, categoryForm({ ...fields, feedCategory }));
      expect(state, feedCategory).toMatchObject({ status: 'refused', reason: 'gone', feedCategory });
    }
    expect(await snapshot()).toEqual(before);
  });

  it('a string another feed carries is not listed for this feed, so it is refused here', async () => {
    const { fields } = await world();
    const other = await aFeed();
    await productIn(other.feedId, 'Solo del otro');
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await assignCategoryAction(IDLE, categoryForm({ ...fields, feedCategory: 'Solo del otro' }))).toMatchObject({
      status: 'refused',
      reason: 'gone',
    });
    expect(await allRecords()).toEqual([]);
  });

  it('surrounding white space is folded: " Filtros " saves the record under "Filtros"', async () => {
    const { feedId, aceite, product } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const state = await assignCategoryAction(IDLE, categoryForm({ feedId, feedCategory: `  ${CAT}\t`, target: aceite.id }));

    expect(state).toMatchObject({ status: 'saved', feedCategory: CAT });
    expect(await allRecords()).toMatchObject([{ feedCategory: CAT }]);
    expect((await categoryBySlug())[product.slug]).toBe(aceite.id);
  });

  it('a record no offer carries is still listed, so it can be changed and removed (AC 8 with AC 17)', async () => {
    const { feedId, fields } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    await assignCategoryAction(IDLE, categoryForm(fields));
    await getDb().delete(offers);

    expect(await removeCategoryMappingAction(IDLE, categoryForm({ feedId, feedCategory: CAT }))).toMatchObject({ status: 'saved' });
    expect(await allRecords()).toEqual([]);
  });
});

describe('a write that throws returns failed and logs a code only (AC 45)', () => {
  it.each(ACTIONS)('%s: the state is failed, the log is the fixed prefix and the code, and nothing is half-changed', async (_name, action) => {
    const { feedId, aceite, fields } = await world();
    // Start from a mapped state so every action has a product to move.
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    await assignCategoryAction(IDLE, categoryForm({ feedId, feedCategory: CAT, target: aceite.id }));
    const before = await snapshot();
    const lines = capture();
    vi.mocked(revalidatePath).mockClear();
    const target = (await fiveTargets())[1].id;

    const state = await withFailingProductUpdates(() => action(IDLE, categoryForm({ ...fields, target })));

    expect(state).toEqual({ status: 'failed', feedId, feedCategory: CAT });
    expect(JSON.stringify(state)).not.toMatch(/KEY|apikey|boom|feeds\.example/);
    expect(lines).toEqual(['admin-categories: failed (P0001)']);
    expect(await snapshot()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('logs nothing for a validation refusal', async () => {
    const { fields } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const lines = capture();

    await assignCategoryAction(IDLE, categoryForm({ ...fields, target: '' }));
    await assignCategoryAction(IDLE, categoryForm({ ...fields, feedCategory: `x ${KEY}` }));
    await removeCategoryMappingAction(IDLE, categoryForm({ feedId: 2000000000, feedCategory: CAT }));

    expect(lines).toEqual([]);
  });
});
