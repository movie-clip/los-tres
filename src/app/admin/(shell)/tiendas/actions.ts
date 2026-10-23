'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSiteUrl } from '@/config/auth';
import { setFeedApproval, setShopApproval } from '@/server/admin/sources';
import { isAdminRefusal, requireAdminAction } from '@/server/auth/guard';
import { isSameSiteOrigin } from '@/server/auth/origin';
import { errorCode } from '@/server/error-code';

// Approve or disable a shop or a feed (US-2.3, guardrail 1). The target is
// explicit ("approve" or "disable"), never a toggle, and every value returned
// comes from the row the database stored. Logs carry a fixed prefix and a
// code: never an email, an id, a URL or a form value (guardrail 5).

export type SourceActionState =
  | { status: 'idle' }
  | { status: 'done'; kind: 'shop'; id: number; approved: boolean }
  | { status: 'done'; kind: 'feed'; id: number; approved: boolean; shopApproved: boolean }
  | { status: 'failed'; kind: 'shop' | 'feed'; id: number | null };

type Kind = 'shop' | 'feed';

/** Postgres `integer` ceiling: a larger id cannot name a row. */
const MAX_ID = 2_147_483_647;

function parseId(form: FormData): number | null {
  const raw = form.get('id');
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_ID ? id : null;
}

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

/** Steps 2 to 5 of the action, after the role check. */
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

  const id = parseId(form);
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
