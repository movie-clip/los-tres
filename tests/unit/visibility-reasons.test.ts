import { and, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NOT_PUBLIC_REASONS,
  OFFER_CAUSES,
  OFFER_NOT_PUBLIC_REASONS,
  PRODUCT_CAUSES,
  PRODUCT_NOT_PUBLIC_REASONS,
  offerNotPublicReasonSql,
  offerRules,
  productNotPublicReasonSql,
  productRules,
  reasonCaseSql,
  toNotPublicReason,
  visibleOfferWhere,
  visibleProductWhere,
} from '@/server/visibility';

import { BACKSTOP_MODES, stubLocalFlag, type LocalFlagMode } from '../support/local-flag';

// US-2.5 (T-2.5.3b), D-14 and ACs 5, 8, 9, 26: the guard that ties the admin's reason to the public
// condition. The two public builders are the AND of their rule tables, and the reason is the first rule of the
// same table that fails, so a condition added to a public builder outside its table (or a table that drifts
// from the public body) must fail here. Everything is rendered to SQL text and compared: no database.
// The restated flag condition of 05-backend § Departures 1 (the public bodies keep the literal ternary that
// seams C-4 pins, the tables restate it once) is held equal to the public body in every mode of the local flag.

const dialect = new PgDialect();
const render = (condition: SQL | undefined) => {
  if (condition === undefined) throw new Error('no condition to render');
  return dialect.sqlToQuery(condition);
};
const andOf = (rules: { holds: SQL }[]) => and(...rules.map((rule) => rule.holds));

/** The mode that shows collected rows is `on`; every other mode, the backstop included, leaves them out. */
const MODES: LocalFlagMode[] = ['off', 'on', ...BACKSTOP_MODES];
const shownIn = (mode: LocalFlagMode) => mode === 'on';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the public condition is the AND of its rule table, in every mode of the local flag (D-14, AC 9)', () => {
  it.each(MODES)('the offer scope equals the offer table, mode %s', (mode) => {
    stubLocalFlag(mode);
    expect(render(visibleOfferWhere())).toEqual(render(andOf(offerRules(shownIn(mode)))));
    // The table with no argument reads the flag the same way the public builder does.
    expect(render(andOf(offerRules()))).toEqual(render(andOf(offerRules(shownIn(mode)))));
  });

  it.each(MODES)('the product scope equals the product table, mode %s', (mode) => {
    stubLocalFlag(mode);
    expect(render(visibleProductWhere())).toEqual(render(andOf(productRules(shownIn(mode)))));
    expect(render(andOf(productRules()))).toEqual(render(andOf(productRules(shownIn(mode)))));
  });

  it('fails on a conjunct added beside the table, on a dropped rule and on a rule moved out of order', () => {
    stubLocalFlag('off');
    const offers = offerRules(false);
    const table = render(andOf(offers));
    expect(render(and(visibleOfferWhere(), sql`offers.price_cents < 999999`))).not.toEqual(table);
    expect(render(andOf(offers.slice(1)))).not.toEqual(table);
    expect(render(andOf([...offers].reverse()))).not.toEqual(table);

    const products = render(andOf(productRules(false)));
    expect(render(and(visibleProductWhere(), sql`products.title <> ''`))).not.toEqual(products);
    expect(render(andOf(productRules(false).slice(1)))).not.toEqual(products);
    // The unplanted public scope still matches, so the failures above are the plant's.
    expect(render(visibleProductWhere())).toEqual(products);
  });

  it('keeps the causes in the order the owner ruled (D-1), the collected rule leaving the table when rows are shown', () => {
    expect(offerRules(false).map((rule) => rule.cause)).toEqual([
      'shop_not_approved',
      'feed_not_approved',
      'collected',
      'removed',
      'hidden',
      'in_review',
    ]);
    expect(offerRules(false).map((rule) => rule.cause)).toEqual([...OFFER_CAUSES]);
    expect(offerRules(true).map((rule) => rule.cause)).toEqual(OFFER_CAUSES.filter((cause) => cause !== 'collected'));
    expect(productRules(false).map((rule) => rule.cause)).toEqual([...PRODUCT_CAUSES, 'has_visible_offer']);
    expect(productRules(false).map((rule) => rule.cause).slice(0, 3)).toEqual(['no_category', 'collected', 'hidden']);
    expect(productRules(true).map((rule) => rule.cause)).toEqual([
      'no_category',
      'hidden',
      'has_visible_offer',
    ]);
  });
});

describe('the closed set of reasons (AC 5, 8, 30)', () => {
  it('holds the 17 codes, each once, and the offer and product sets together are exactly those', () => {
    expect(NOT_PUBLIC_REASONS).toHaveLength(17);
    expect(new Set(NOT_PUBLIC_REASONS).size).toBe(17);
    expect(new Set([...OFFER_NOT_PUBLIC_REASONS, ...PRODUCT_NOT_PUBLIC_REASONS])).toEqual(new Set(NOT_PUBLIC_REASONS));
    expect(OFFER_NOT_PUBLIC_REASONS).toContain('unknown');
    expect(PRODUCT_NOT_PUBLIC_REASONS).toContain('unknown');
    // An offer row never says "no offers" or names its siblings; a product row never uses the offer's own codes.
    expect(OFFER_NOT_PUBLIC_REASONS.filter((code: string) => code === 'product_no_offers' || code.startsWith('offers_'))).toEqual([]);
    expect(PRODUCT_NOT_PUBLIC_REASONS.filter((code) => code.startsWith('offer_'))).toEqual([]);
  });

  it('reads anything outside the set as unknown, never as a blank, and null as no reason', () => {
    for (const code of NOT_PUBLIC_REASONS) expect(toNotPublicReason(code)).toBe(code);
    expect(toNotPublicReason(null)).toBeNull();
    expect(toNotPublicReason(undefined)).toBeNull();
    for (const stray of ['', 'offer_nothing', 'OFFER_HIDDEN', 42, true, {}, ['offer_hidden']]) {
      expect(toNotPublicReason(stray), String(stray)).toBe('unknown');
    }
    // With a narrower set a code of the other set is outside it.
    expect(toNotPublicReason('offers_hidden', OFFER_NOT_PUBLIC_REASONS)).toBe('unknown');
    expect(toNotPublicReason('offer_hidden', OFFER_NOT_PUBLIC_REASONS)).toBe('offer_hidden');
    expect(toNotPublicReason('offer_hidden', PRODUCT_NOT_PUBLIC_REASONS)).toBe('unknown');
    expect(toNotPublicReason(null, PRODUCT_NOT_PUBLIC_REASONS)).toBeNull();
  });
});

describe('the reason builders are literal, ordered and follow one reading of the flag (AC 26)', () => {
  const codesIn = (text: string) => [...text.matchAll(/then '([a-z_]+)'/g)].map((match) => match[1]);

  it.each(MODES)('names the collected code exactly when rows are not shown, mode %s', (mode) => {
    stubLocalFlag(mode);
    const offer = render(offerNotPublicReasonSql());
    const product = render(productNotPublicReasonSql());
    const hasCollected = !shownIn(mode);
    expect(codesIn(offer.sql).includes('offer_collected')).toBe(hasCollected);
    expect(codesIn(offer.sql).includes('product_collected')).toBe(hasCollected);
    expect(codesIn(product.sql).includes('product_collected')).toBe(hasCollected);
    expect(codesIn(product.sql).includes('offers_collected')).toBe(hasCollected);
    // The other causes never depend on the flag.
    for (const code of ['offer_shop_not_approved', 'offer_removed', 'product_no_category', 'product_hidden']) {
      expect(codesIn(offer.sql), code).toContain(code);
    }
    for (const code of ['product_no_offers', 'offers_shop_not_approved', 'offers_in_review', 'product_hidden']) {
      expect(codesIn(product.sql), code).toContain(code);
    }
  });

  it('writes every code as a SQL literal, never a bound parameter, and ends in unknown then null', () => {
    stubLocalFlag('off');
    for (const built of [render(offerNotPublicReasonSql()), render(productNotPublicReasonSql())]) {
      for (const code of NOT_PUBLIC_REASONS) expect(built.params, code).not.toContain(code);
      expect(built.sql).toMatch(/then 'unknown' else null end\)$/);
    }
  });

  it('names the offer causes in the owner order, each before the product causes (D-1)', () => {
    stubLocalFlag('off');
    const codes = codesIn(render(offerNotPublicReasonSql()).sql);
    expect(codes).toEqual([
      'offer_shop_not_approved',
      'offer_feed_not_approved',
      'offer_collected',
      'offer_removed',
      'offer_hidden',
      'offer_in_review',
      'product_no_category',
      'product_collected',
      'product_hidden',
      'unknown',
    ]);
  });

  it('puts the unknown branch after every named one in the shared CASE, and a public row on null', () => {
    const built = render(
      reasonCaseSql(
        [
          { failing: sql`a`, code: sql.raw("'first'") },
          { failing: sql`b`, code: sql.raw("'second'") },
        ],
        sql`c`,
      ),
    );
    expect(built.sql).toBe("(case when a then 'first' when b then 'second' when not coalesce((c), false) then 'unknown' else null end)");
  });
});
