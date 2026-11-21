import 'server-only';

import { asc, eq, isNotNull, sql } from 'drizzle-orm';

// Relative on purpose: files in src/server import each other relatively.
import { getDb, type Executor } from '../../db/client';
import { feeds, networks, offers, shops } from '../../db/schema';
import {
  checkCatalogueFileName,
  displayableFileName,
  type CatalogueFileNameError,
} from '../catalogue-file-name';
import { feedHost } from './feed-host';
import {
  FEED_URL_MAX,
  checkName,
  checkSlug,
  parseId,
  textField,
  type NameError,
  type SlugError,
} from './source-rules';

// The admin's view of networks, shops and feeds, and the only code that writes
// them outside the seed (guardrail 1, S2.3 and S3.1): it creates and edits all
// three tables and sets `shops.is_approved` and `feeds.is_approved`. With
// `feed-host.ts` it is the only admin code that names a feed's address, which
// may embed a network API key (guardrail 5): the address enters here from a
// form and leaves only through `feedHost`, as the `host` of a read. No type
// below has a field for the address itself, and no error object, message or
// form value leaves a writer: it returns fixed codes or throws.
//
// S3.7: a catalogue-file feed stores a bare file name in the same column. The
// name enters from a form, is checked by `checkCatalogueFileName` before it is
// stored, and leaves only through `displayableFileName` as the `fileName` of a
// read (null for a stored value that is not a name). Registering or editing one
// reads no file and approves nothing: the importer is the only reader of the
// folder, and a file feed is created and edited unapproved (guardrail 1).

export type AdminFeedSource = 'affiliate_network' | 'shop_upload' | 'catalogue_file';

export type AdminFeed = {
  id: number;
  approved: boolean;
  demo: boolean;
  source: AdminFeedSource;
  /** `networks.id`; null for a shop upload and for a catalogue file. */
  networkId: number | null;
  /** `networks.name`; null when the feed has no network (a shop upload, a catalogue file). */
  networkName: string | null;
  /** All stored offers of this feed, hidden and in-review included. */
  offerCount: number;
  /** The host of the stored address, or null when it cannot be read as one (a demo feed, a file name); always null for a catalogue file, which is never read as an address. */
  host: string | null;
  /** A catalogue file only: the stored file name when it is one by the rule, else null; null for every other source. */
  fileName: string | null;
};

export type AdminShop = {
  id: number;
  name: string;
  slug: string;
  approved: boolean;
  /** Derived (D-8): at least one feed and every feed a demo feed. */
  demo: boolean;
  /** The sum of its feeds' offer counts. */
  offerCount: number;
  /** By id ascending. */
  feeds: AdminFeed[];
};

export type AdminNetwork = {
  id: number;
  name: string;
  slug: string;
  /** Derived (D-8): at least one feed with this network and every one a demo feed. */
  demo: boolean;
};

export type AdminNameSlug = { id: number; name: string; slug: string };

export type AdminFeedEdit =
  | {
      source: 'affiliate_network';
      id: number;
      shopId: number;
      shopName: string;
      /** Affiliate feeds only, so never null here. */
      networkId: number;
      approved: boolean;
      demo: boolean;
      host: string | null;
    }
  | {
      source: 'catalogue_file';
      id: number;
      shopId: number;
      shopName: string;
      approved: boolean;
      demo: boolean;
      /** The stored file name when it is one by the rule, else null (shown as unavailable). */
      fileName: string | null;
    };

export type ShopApprovalStored = { shopId: number; approved: boolean };
export type FeedApprovalStored = { feedId: number; approved: boolean; shopApproved: boolean };

export type SourceFieldErrors = {
  name?: NameError;
  slug?: SlugError | 'taken';
  /** None chosen, malformed, or no such shop. */
  shop?: 'required';
  /** None chosen, malformed, or no such network. */
  network?: 'required';
  url?: 'required' | 'invalid' | 'credentials' | 'too_long' | 'duplicate';
  /** A create form with a source that is neither affiliate_network nor catalogue_file. */
  source?: 'invalid';
  /** Catalogue-file feeds only (S3.7). */
  fileName?: CatalogueFileNameError | 'duplicate';
};

export type SourceWrite =
  /** `unapproved` is true only when updateFeed turned an approved feed unapproved. */
  | { status: 'written'; id: number; unapproved: boolean }
  | { status: 'refused'; errors: SourceFieldErrors }
  /** An edit of an id that does not exist, or of a shop upload feed. */
  | { status: 'missing' };

/**
 * Every shop with its feeds and offer counts, shops by name then id. Named
 * columns only. The stored address is selected, turned into its host inside
 * the row loop, and never returned.
 */
export async function listSourcesForAdmin(): Promise<AdminShop[]> {
  const db = getDb();

  const shopRows = await db
    .select({ id: shops.id, name: shops.name, slug: shops.slug, approved: shops.isApproved })
    .from(shops)
    .orderBy(asc(shops.name), asc(shops.id));

  const feedRows = await db
    .select({
      id: feeds.id,
      shopId: feeds.shopId,
      approved: feeds.isApproved,
      demo: feeds.isDemo,
      source: feeds.sourceType,
      networkId: feeds.networkId,
      networkName: networks.name,
      stored: feeds.url,
      offerCount: sql<number>`count(${offers.id})::int`,
    })
    .from(feeds)
    .leftJoin(networks, eq(feeds.networkId, networks.id))
    .leftJoin(offers, eq(offers.feedId, feeds.id))
    .groupBy(feeds.id, networks.name)
    .orderBy(asc(feeds.id));

  const feedsByShop = new Map<number, AdminFeed[]>();
  for (const row of feedRows) {
    // A catalogue file's stored value is a file name, never an address: feedHost is not called for it.
    const isFile = row.source === 'catalogue_file';
    const feed: AdminFeed = {
      id: row.id,
      approved: row.approved,
      demo: row.demo,
      source: row.source,
      networkId: row.networkId,
      networkName: row.networkName,
      offerCount: Number(row.offerCount),
      host: isFile ? null : feedHost(row.stored),
      fileName: isFile ? displayableFileName(row.stored) : null,
    };
    const list = feedsByShop.get(row.shopId);
    if (list) list.push(feed);
    else feedsByShop.set(row.shopId, [feed]);
  }

  return shopRows.map((shop) => {
    const shopFeeds = feedsByShop.get(shop.id) ?? [];
    return {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      approved: shop.approved,
      demo: shopFeeds.length > 0 && shopFeeds.every((feed) => feed.demo),
      offerCount: shopFeeds.reduce((sum, feed) => sum + feed.offerCount, 0),
      feeds: shopFeeds,
    };
  });
}

/** Every network, by name then id, with the derived demo marker. */
export async function listNetworksForAdmin(): Promise<AdminNetwork[]> {
  const db = getDb();

  const networkRows = await db
    .select({ id: networks.id, name: networks.name, slug: networks.slug })
    .from(networks)
    .orderBy(asc(networks.name), asc(networks.id));

  const feedGroups = await db
    .select({
      networkId: feeds.networkId,
      allDemo: sql<boolean>`bool_and(${feeds.isDemo})`,
    })
    .from(feeds)
    .where(isNotNull(feeds.networkId))
    .groupBy(feeds.networkId);

  const demoByNetwork = new Map<number, boolean>();
  for (const group of feedGroups) {
    if (group.networkId !== null) demoByNetwork.set(group.networkId, group.allDemo === true);
  }

  return networkRows.map((network) => ({
    id: network.id,
    name: network.name,
    slug: network.slug,
    demo: demoByNetwork.get(network.id) ?? false,
  }));
}

export async function getNetworkForEdit(id: number): Promise<AdminNameSlug | null> {
  const rows = await getDb()
    .select({ id: networks.id, name: networks.name, slug: networks.slug })
    .from(networks)
    .where(eq(networks.id, id));
  return rows[0] ?? null;
}

export async function getShopForEdit(id: number): Promise<AdminNameSlug | null> {
  const rows = await getDb()
    .select({ id: shops.id, name: shops.name, slug: shops.slug })
    .from(shops)
    .where(eq(shops.id, id));
  return rows[0] ?? null;
}

/** One affiliate or catalogue-file feed for its edit form, or null when the id is unknown or the feed is a shop upload. */
export async function getFeedForEdit(id: number): Promise<AdminFeedEdit | null> {
  const rows = await getDb()
    .select({
      id: feeds.id,
      shopId: feeds.shopId,
      shopName: shops.name,
      networkId: feeds.networkId,
      approved: feeds.isApproved,
      demo: feeds.isDemo,
      source: feeds.sourceType,
      stored: feeds.url,
    })
    .from(feeds)
    .innerJoin(shops, eq(feeds.shopId, shops.id))
    .where(eq(feeds.id, id));
  const row = rows[0];
  if (!row) return null;
  if (row.source === 'catalogue_file') {
    return {
      source: 'catalogue_file',
      id: row.id,
      shopId: row.shopId,
      shopName: row.shopName,
      approved: row.approved,
      demo: row.demo,
      fileName: displayableFileName(row.stored),
    };
  }
  if (row.source !== 'affiliate_network' || row.networkId === null) return null;
  return {
    source: 'affiliate_network',
    id: row.id,
    shopId: row.shopId,
    shopName: row.shopName,
    networkId: row.networkId,
    approved: row.approved,
    demo: row.demo,
    host: feedHost(row.stored),
  };
}

// ---------------------------------------------------------------- address

type UrlError = 'required' | 'invalid' | 'credentials' | 'too_long';

/** Any character at or below U+0020, or DEL: blank space and control characters. */
const BLANK_OR_CONTROL = /[\u0000- \u007f]/;

/**
 * The rule of a feed address (AC 16, D-T7), applied to the trimmed input: https
 * only, a host, no user name or password, at most 2048 characters. The address
 * is stored as typed, never as `url.href`, so a signed query string is not
 * re-encoded. Returns a fixed code, never the value.
 */
function checkFeedUrl(trimmed: string): UrlError | null {
  if (trimmed === '') return 'required';
  if (trimmed.length > FEED_URL_MAX) return 'too_long';
  if (BLANK_OR_CONTROL.test(trimmed)) return 'invalid';
  if (!/^https:\/\//i.test(trimmed)) return 'invalid';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:' || url.hostname === '') return 'invalid';
  if (url.username !== '' || url.password !== '') return 'credentials';
  return null;
}

/** A unique violation of the shop-and-address pair, read from the driver error's code and constraint only. */
function isFeedUrlConflict(error: unknown): boolean {
  const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const source = cause ?? error;
  if (typeof source !== 'object' || source === null) return false;
  const { code, constraint } = source as { code?: unknown; constraint?: unknown };
  return code === '23505' && constraint === 'feeds_shop_id_url_unique';
}

async function networkExists(db: Executor, id: number | null): Promise<boolean> {
  if (id === null) return false;
  const rows = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, id));
  return rows.length > 0;
}

async function shopExists(db: Executor, id: number | null): Promise<boolean> {
  if (id === null) return false;
  const rows = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, id));
  return rows.length > 0;
}

// ---------------------------------------------------------------- writers

const written = (id: number, unapproved = false): SourceWrite => ({ status: 'written', id, unapproved });
const refused = (errors: SourceFieldErrors): SourceWrite => ({ status: 'refused', errors });
const MISSING: SourceWrite = { status: 'missing' };

/** Creates a network from `name` and `slug`. Reads no other field. */
export async function createNetwork(form: FormData): Promise<SourceWrite> {
  const name = checkName(textField(form, 'name'));
  const slug = checkSlug(textField(form, 'slug'), 'network');
  const errors: SourceFieldErrors = {};
  if (name.error) errors.name = name.error;
  if (slug.error) errors.slug = slug.error;
  if (Object.keys(errors).length > 0) return refused(errors);

  const rows = await getDb()
    .insert(networks)
    .values({ name: name.value, slug: slug.value })
    .onConflictDoNothing({ target: networks.slug })
    .returning({ id: networks.id });
  return rows[0] ? written(rows[0].id) : refused({ slug: 'taken' });
}

/** Renames a network by `id`. The slug is never read: it is fixed once created. */
export async function updateNetwork(form: FormData): Promise<SourceWrite> {
  const id = parseId(form.get('id'));
  if (id === null) return MISSING;
  const name = checkName(textField(form, 'name'));
  if (name.error) return refused({ name: name.error });

  const rows = await getDb()
    .update(networks)
    .set({ name: name.value })
    .where(eq(networks.id, id))
    .returning({ id: networks.id });
  return rows[0] ? written(rows[0].id) : MISSING;
}

/** Creates an unapproved shop from `name` and `slug`. Reads no other field. */
export async function createShop(form: FormData): Promise<SourceWrite> {
  const name = checkName(textField(form, 'name'));
  const slug = checkSlug(textField(form, 'slug'), 'shop');
  const errors: SourceFieldErrors = {};
  if (name.error) errors.name = name.error;
  if (slug.error) errors.slug = slug.error;
  if (Object.keys(errors).length > 0) return refused(errors);

  const rows = await getDb()
    .insert(shops)
    .values({ name: name.value, slug: slug.value, isApproved: false })
    .onConflictDoNothing({ target: shops.slug })
    .returning({ id: shops.id });
  return rows[0] ? written(rows[0].id) : refused({ slug: 'taken' });
}

/** Renames a shop by `id`. Neither the slug nor the approval is read or touched. */
export async function updateShop(form: FormData): Promise<SourceWrite> {
  const id = parseId(form.get('id'));
  if (id === null) return MISSING;
  const name = checkName(textField(form, 'name'));
  if (name.error) return refused({ name: name.error });

  const rows = await getDb()
    .update(shops)
    .set({ name: name.value })
    .where(eq(shops.id, id))
    .returning({ id: shops.id });
  return rows[0] ? written(rows[0].id) : MISSING;
}

/**
 * Creates an unapproved, non-demo feed. The `source` field picks the kind: absent
 * or empty is an affiliate feed (the S3.1 form posts none), `affiliate_network`
 * and `catalogue_file` are the two kinds, and any other value is refused with no
 * write. No other field decides anything: approval and demo are never read.
 */
export async function createFeed(form: FormData): Promise<SourceWrite> {
  const raw = form.get('source');
  if (raw === null || raw === '') return createAffiliateFeed(form);
  if (raw === 'affiliate_network') return createAffiliateFeed(form);
  if (raw === 'catalogue_file') return createFileFeed(form);
  return refused({ source: 'invalid' });
}

/**
 * Creates an unapproved, non-demo catalogue-file feed from `shopId` and
 * `fileName`; `networkId` and `url` are not read. The name is checked by the
 * shared rule and stored as accepted; nothing on disk is looked at (AC 9). A
 * second row for the same shop and name is refused by the unique constraint, so
 * two simultaneous requests make one row.
 */
async function createFileFeed(form: FormData): Promise<SourceWrite> {
  const shopId = parseId(form.get('shopId'));
  const name = checkCatalogueFileName(textField(form, 'fileName'));

  return getDb().transaction(async (tx): Promise<SourceWrite> => {
    const errors: SourceFieldErrors = {};
    if (!(await shopExists(tx, shopId))) errors.shop = 'required';
    if (name.error) errors.fileName = name.error;
    if (Object.keys(errors).length > 0 || shopId === null) return refused(errors);

    const rows = await tx
      .insert(feeds)
      .values({
        shopId,
        networkId: null,
        sourceType: 'catalogue_file',
        url: name.value,
        isApproved: false,
        isDemo: false,
      })
      .onConflictDoNothing({ target: [feeds.shopId, feeds.url] })
      .returning({ id: feeds.id });
    return rows[0] ? written(rows[0].id) : refused({ fileName: 'duplicate' });
  });
}

/**
 * Creates an unapproved, non-demo affiliate feed from `shopId`, `networkId` and
 * `url`. Every field is checked before the write and all errors come back at
 * once.
 */
async function createAffiliateFeed(form: FormData): Promise<SourceWrite> {
  const shopId = parseId(form.get('shopId'));
  const networkId = parseId(form.get('networkId'));
  const address = textField(form, 'url').trim();
  const addressError = checkFeedUrl(address);

  return getDb().transaction(async (tx): Promise<SourceWrite> => {
    const errors: SourceFieldErrors = {};
    if (!(await shopExists(tx, shopId))) errors.shop = 'required';
    if (!(await networkExists(tx, networkId))) errors.network = 'required';
    if (addressError) errors.url = addressError;
    if (Object.keys(errors).length > 0 || shopId === null || networkId === null) return refused(errors);

    const rows = await tx
      .insert(feeds)
      .values({
        shopId,
        networkId,
        sourceType: 'affiliate_network',
        url: address,
        isApproved: false,
        isDemo: false,
      })
      .onConflictDoNothing({ target: [feeds.shopId, feeds.url] })
      .returning({ id: feeds.id });
    return rows[0] ? written(rows[0].id) : refused({ url: 'duplicate' });
  });
}

/**
 * Edits an affiliate feed by `id`: its network, and its address when the feed is
 * not a demo feed and `url` is not empty. Never reads `shopId`. Replacing the
 * address sets it and returns the feed to unapproved in one UPDATE, so no moment
 * exists in which the new address is approved (AC 20). The row is locked first,
 * so `unapproved` is read from the state the UPDATE then changes.
 *
 * The branch is the stored source of the locked row, never a form field. A
 * catalogue-file feed (S3.7) reads `fileName` only: the same name, exactly after
 * the trim, writes nothing; a new name is stored and returns the feed to
 * unapproved in one UPDATE (D-7). A shop upload or an unknown id is `missing`.
 */
export async function updateFeed(form: FormData): Promise<SourceWrite> {
  const id = parseId(form.get('id'));
  if (id === null) return MISSING;
  const networkId = parseId(form.get('networkId'));
  // Which field a unique violation is reported on: set from the stored source once the row is locked.
  let conflictField = 'url' as 'url' | 'fileName';

  try {
    return await getDb().transaction(async (tx): Promise<SourceWrite> => {
      const rows = await tx
        .select({
          id: feeds.id,
          demo: feeds.isDemo,
          approved: feeds.isApproved,
          source: feeds.sourceType,
          stored: feeds.url,
        })
        .from(feeds)
        .where(eq(feeds.id, id))
        .for('update');
      const feed = rows[0];
      if (!feed) return MISSING;

      if (feed.source === 'catalogue_file') {
        conflictField = 'fileName';
        const name = checkCatalogueFileName(textField(form, 'fileName'));
        if (name.error) return refused({ fileName: name.error });
        // The same name again changes nothing, and so leaves an approved feed approved.
        if (name.value === feed.stored) return written(id, false);
        await tx.update(feeds).set({ url: name.value, isApproved: false }).where(eq(feeds.id, id));
        return written(id, feed.approved);
      }
      if (feed.source !== 'affiliate_network') return MISSING;

      const errors: SourceFieldErrors = {};
      if (!(await networkExists(tx, networkId))) errors.network = 'required';

      // A demo feed's address is read-only: a crafted field is not even read (AC 22).
      let replacement: string | null = null;
      if (!feed.demo) {
        const address = textField(form, 'url').trim();
        if (address !== '') {
          const addressError = checkFeedUrl(address);
          if (addressError) errors.url = addressError;
          else replacement = address;
        }
      }
      if (Object.keys(errors).length > 0 || networkId === null) return refused(errors);

      await tx
        .update(feeds)
        .set(replacement === null ? { networkId } : { networkId, url: replacement, isApproved: false })
        .where(eq(feeds.id, id));
      return written(id, feed.approved && replacement !== null);
    });
  } catch (error) {
    if (isFeedUrlConflict(error)) {
      return refused(conflictField === 'fileName' ? { fileName: 'duplicate' } : { url: 'duplicate' });
    }
    throw error;
  }
}

// ---------------------------------------------------------------- approval

/**
 * Sets one shop's approval to `approved` and returns the stored value, or null
 * when no such shop exists. Touches no feed and no other column. Idempotent.
 */
export async function setShopApproval(
  shopId: number,
  approved: boolean,
): Promise<ShopApprovalStored | null> {
  const rows = await getDb()
    .update(shops)
    .set({ isApproved: approved })
    .where(eq(shops.id, shopId))
    .returning({ shopId: shops.id, approved: shops.isApproved });
  return rows[0] ?? null;
}

/**
 * Sets one feed's approval to `approved` and returns the stored value with its
 * shop's stored approval, or null when no such feed exists. One statement;
 * touches no shop and no other column. Idempotent.
 */
export async function setFeedApproval(
  feedId: number,
  approved: boolean,
): Promise<FeedApprovalStored | null> {
  const rows = await getDb()
    .update(feeds)
    .set({ isApproved: approved })
    .from(shops)
    .where(sql`${feeds.id} = ${feedId} and ${feeds.shopId} = ${shops.id}`)
    .returning({ feedId: feeds.id, approved: feeds.isApproved, shopApproved: shops.isApproved });
  return rows[0] ?? null;
}
