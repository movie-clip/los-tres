'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSiteUrl } from '@/config/auth';
import { parseHideTarget } from '@/server/admin/product-rules';
import { setOfferHidden, setProductHidden, type HiddenStored } from '@/server/admin/products';
import { parseId } from '@/server/admin/source-rules';
import { isAdminRefusal, requireAdminAction } from '@/server/auth/guard';
import { isSameSiteOrigin } from '@/server/auth/origin';
import { driverErrorCode, errorCode } from '@/server/error-code';

// Hide or unhide a product or one of its offers (US-2.4, guardrail 1). Each
// action checks the role first, then the origin, then reads two fields only,
// the id and the target, and runs one writer. The target is explicit ("hide" or
// "unhide"), never a toggle, so a stale page or a second admin cannot reverse
// the other's action, and every value returned is read back from the row the
// database stored. The answer is a state for the page, never a redirect.
// Logs carry a fixed prefix and a code: never an id, a slug, a search term, a
// shop, a URL or an error message (guardrail 5). No offer address is read or
// returned, and no public page is revalidated: public pages are served
// uncached, so a hide shows at the next request.

type Kind = 'product' | 'offer';

export type HideActionState =
  | { status: 'idle' }
  | { status: 'done'; kind: Kind; id: number; hidden: boolean; publicNow: boolean }
  | { status: 'gone'; kind: Kind; id: number }
  | { status: 'failed'; kind: Kind; id: number | null };

/** Whether this request came from the site's own origin. Reads no body. */
async function originAllowed(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameSiteOrigin(requestHeaders.get('origin'), getSiteUrl());
}

/** Steps 2 to 5 of a hide action, after the role check. */
async function apply(kind: Kind, form: FormData): Promise<HideActionState> {
  try {
    if (!(await originAllowed())) {
      console.error('admin-products: refused (ORIGIN)');
      return { status: 'failed', kind, id: null };
    }
  } catch (error) {
    console.error(`admin-products: failed (${errorCode(error)})`);
    return { status: 'failed', kind, id: null };
  }

  const id = parseId(form.get('id'));
  const hidden = parseHideTarget(form.get('target'));
  if (id === null || hidden === null) return { status: 'failed', kind, id };

  let stored: HiddenStored | null;
  try {
    stored = kind === 'product' ? await setProductHidden(id, hidden) : await setOfferHidden(id, hidden);
  } catch (error) {
    console.error(`admin-products: failed (${driverErrorCode(error)})`);
    return { status: 'failed', kind, id };
  }
  if (stored === null) return { status: 'gone', kind, id };

  revalidatePath('/admin/productos', 'layout');
  return { status: 'done', kind, id: stored.id, hidden: stored.hidden, publicNow: stored.publicNow };
}

export async function setProductHiddenAction(
  _previous: HideActionState,
  form: FormData,
): Promise<HideActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', kind: 'product', id: null };
  }
  return apply('product', form);
}

export async function setOfferHiddenAction(
  _previous: HideActionState,
  form: FormData,
): Promise<HideActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', kind: 'offer', id: null };
  }
  return apply('offer', form);
}
