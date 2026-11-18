'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSiteUrl } from '@/config/auth';
import {
  createFeed,
  createNetwork,
  createShop,
  setFeedApproval,
  setShopApproval,
  updateFeed,
  updateNetwork,
  updateShop,
  type SourceFieldErrors,
  type SourceWrite,
} from '@/server/admin/sources';
import { parseId, type SourceNotice } from '@/server/admin/source-rules';
import { isAdminRefusal, requireAdminAction } from '@/server/auth/guard';
import { isSameSiteOrigin } from '@/server/auth/origin';
import { errorCode } from '@/server/error-code';

// Approve or disable a shop or a feed (US-2.3, guardrail 1), and create or edit
// a network, a shop or a feed (US-3.1). The approval target is explicit
// ("approve" or "disable"), never a toggle, and every value returned comes from
// the row the database stored. Logs carry a fixed prefix and a code: never an
// email, an id, a URL, a form value or an error message (guardrail 5). This
// file never reads the `url` form field: the writer does, and no state below
// has a member that could hold one (D-T10).

export type SourceActionState =
  | { status: 'idle' }
  | { status: 'done'; kind: 'shop'; id: number; approved: boolean }
  | { status: 'done'; kind: 'feed'; id: number; approved: boolean; shopApproved: boolean }
  | { status: 'failed'; kind: 'shop' | 'feed'; id: number | null };

/** What a refused or failed form comes back with: never the feed address. */
export type SourceFormValues = { name?: string; slug?: string; shopId?: string; networkId?: string };

export type SourceFormState =
  | { status: 'idle' }
  | { status: 'refused'; errors: SourceFieldErrors; values: SourceFormValues }
  | { status: 'failed'; values: SourceFormValues };

type Kind = 'shop' | 'feed';

function parseTarget(form: FormData): boolean | null {
  const raw = form.get('target');
  if (raw === 'approve') return true;
  if (raw === 'disable') return false;
  return null;
}

/** Whether this request came from the site's own origin. Reads no body. */
async function originAllowed(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameSiteOrigin(requestHeaders.get('origin'), getSiteUrl());
}

/**
 * The code of a failed write, read from the driver error under a Drizzle
 * wrapper when there is one. Only a short code comes out, never a message.
 */
function failureCode(error: unknown): string {
  const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const code = errorCode(cause);
  return code === 'UNKNOWN' ? errorCode(error) : code;
}

/** Steps 2 to 5 of an approval action, after the role check. */
async function apply(kind: Kind, form: FormData): Promise<SourceActionState> {
  try {
    if (!(await originAllowed())) {
      console.error('admin-sources: refused (ORIGIN)');
      return { status: 'failed', kind, id: null };
    }
  } catch (error) {
    console.error(`admin-sources: failed (${errorCode(error)})`);
    return { status: 'failed', kind, id: null };
  }

  const id = parseId(form.get('id'));
  const target = parseTarget(form);
  if (id === null || target === null) return { status: 'failed', kind, id };

  let state: SourceActionState;
  try {
    if (kind === 'shop') {
      const stored = await setShopApproval(id, target);
      state = stored
        ? { status: 'done', kind, id: stored.shopId, approved: stored.approved }
        : { status: 'failed', kind, id };
    } else {
      const stored = await setFeedApproval(id, target);
      state = stored
        ? {
            status: 'done',
            kind,
            id: stored.feedId,
            approved: stored.approved,
            shopApproved: stored.shopApproved,
          }
        : { status: 'failed', kind, id };
    }
  } catch (error) {
    console.error(`admin-sources: failed (${errorCode(error)})`);
    return { status: 'failed', kind, id };
  }

  if (state.status === 'done') revalidatePath('/admin/tiendas');
  return state;
}

/**
 * The submitted values a refused or failed form is shown again with: name,
 * slug, and the two choice ids when they are well-formed ids. Never the `url`
 * field, and nothing else of the form.
 */
function echoedValues(form: FormData): SourceFormValues {
  const values: SourceFormValues = {};
  const name = form.get('name');
  const slug = form.get('slug');
  const shopId = form.get('shopId');
  const networkId = form.get('networkId');
  if (typeof name === 'string') values.name = name;
  if (typeof slug === 'string') values.slug = slug;
  if (typeof shopId === 'string' && parseId(shopId) !== null) values.shopId = shopId;
  if (typeof networkId === 'string' && parseId(networkId) !== null) values.networkId = networkId;
  return values;
}

/**
 * Steps 2 to 5 of a create or edit action, after the role check: the origin
 * check, then the writer inside a try, then the answer. A validation refusal
 * logs nothing; a refused origin or a failed write logs one fixed line. The
 * redirect sits after the try, because a redirect thrown inside it would be
 * caught as a failure.
 */
async function submit(
  form: FormData,
  write: (form: FormData) => Promise<SourceWrite>,
  noticeFor: (result: Extract<SourceWrite, { status: 'written' }>) => SourceNotice,
): Promise<SourceFormState> {
  try {
    if (!(await originAllowed())) {
      console.error('admin-sources: refused (ORIGIN)');
      return { status: 'failed', values: echoedValues(form) };
    }
  } catch (error) {
    console.error(`admin-sources: failed (${errorCode(error)})`);
    return { status: 'failed', values: echoedValues(form) };
  }

  let result: SourceWrite;
  try {
    result = await write(form);
  } catch (error) {
    console.error(`admin-sources: failed (${failureCode(error)})`);
    return { status: 'failed', values: echoedValues(form) };
  }

  if (result.status === 'refused') {
    return { status: 'refused', errors: result.errors, values: echoedValues(form) };
  }
  if (result.status === 'missing') return { status: 'failed', values: echoedValues(form) };

  revalidatePath('/admin/tiendas');
  redirect(`/admin/tiendas?aviso=${noticeFor(result)}`);
}

export async function setShopApprovalAction(
  _previous: SourceActionState,
  form: FormData,
): Promise<SourceActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', kind: 'shop', id: null };
  }
  return apply('shop', form);
}

export async function setFeedApprovalAction(
  _previous: SourceActionState,
  form: FormData,
): Promise<SourceActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', kind: 'feed', id: null };
  }
  return apply('feed', form);
}

export async function createNetworkAction(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', values: echoedValues(form) };
  }
  return submit(form, createNetwork, () => 'red-creada');
}

export async function updateNetworkAction(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', values: echoedValues(form) };
  }
  return submit(form, updateNetwork, () => 'red-guardada');
}

export async function createShopAction(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', values: echoedValues(form) };
  }
  return submit(form, createShop, () => 'tienda-creada');
}

export async function updateShopAction(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', values: echoedValues(form) };
  }
  return submit(form, updateShop, () => 'tienda-guardada');
}

export async function createFeedAction(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', values: echoedValues(form) };
  }
  return submit(form, createFeed, () => 'feed-creado');
}

export async function updateFeedAction(
  _previous: SourceFormState,
  form: FormData,
): Promise<SourceFormState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', values: echoedValues(form) };
  }
  return submit(form, updateFeed, (result) => (result.unapproved ? 'feed-sin-aprobar' : 'feed-guardado'));
}
