'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSiteUrl } from '@/config/auth';
import {
  assignCategory,
  markOutsideScope,
  readFeedCategory,
  removeCategoryMapping,
  type CategoryActionState,
  type CategoryWrite,
} from '@/server/admin/category-mappings';
import { isAdminRefusal, requireAdminAction } from '@/server/auth/guard';
import { isSameSiteOrigin } from '@/server/auth/origin';
import { driverErrorCode, errorCode } from '@/server/error-code';

// Map, change, mark outside scope and remove a feed category (US-4.2,
// guardrail 1). Each action checks the role first, then the origin, then runs
// one writer, which saves the record and re-applies it to the products in a
// single transaction. The answer is a state for the page, never a redirect.
// Logs carry a fixed prefix and a code: never a feed category, an id, a URL, an
// email or an error message (guardrail 5).

export type {
  CategoryActionState,
  CategoryRefusal,
  CategoryRowState,
} from '@/server/admin/category-mappings';

/** Whether this request came from the site's own origin. Reads no body. */
async function originAllowed(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameSiteOrigin(requestHeaders.get('origin'), getSiteUrl());
}

/** The failed answer, naming the row the form pointed at when it can be read. */
function failedState(form: FormData): CategoryActionState {
  const { feedId, feedCategory } = readFeedCategory(form);
  return { status: 'failed', feedId, feedCategory };
}

/** Steps 2 to 4 of an action, after the role check. */
async function apply(
  form: FormData,
  write: (form: FormData) => Promise<CategoryWrite>,
): Promise<CategoryActionState> {
  try {
    if (!(await originAllowed())) {
      console.error('admin-categories: refused (ORIGIN)');
      return failedState(form);
    }
  } catch (error) {
    console.error(`admin-categories: failed (${errorCode(error)})`);
    return failedState(form);
  }

  let result: CategoryWrite;
  try {
    result = await write(form);
  } catch (error) {
    console.error(`admin-categories: failed (${driverErrorCode(error)})`);
    return failedState(form);
  }

  if (result.status === 'saved') revalidatePath('/admin/categorias');
  return result;
}

export async function assignCategoryAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', feedId: null, feedCategory: null };
  }
  return apply(form, assignCategory);
}

export async function markOutsideScopeAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', feedId: null, feedCategory: null };
  }
  return apply(form, markOutsideScope);
}

export async function removeCategoryMappingAction(
  _previous: CategoryActionState,
  form: FormData,
): Promise<CategoryActionState> {
  const who = await requireAdminAction();
  if (isAdminRefusal(who)) {
    if (who.reason === 'unauthenticated') redirect('/admin/acceso?aviso=sesion');
    return { status: 'failed', feedId: null, feedCategory: null };
  }
  return apply(form, removeCategoryMapping);
}
