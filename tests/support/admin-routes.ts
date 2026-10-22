import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { classifyRoute, listRouteFiles } from './routes';

// The enumerate-every-admin-route check of AC 22. It walks an app directory,
// takes every page and route handler that `classifyRoute` calls admin, calls it
// with an anonymous request, and reports each one that answers with admin
// content or a success. A route is found by the directory it sits in, so a new
// admin route that forgets the guard fails without anyone adding a test for it.

/** The only admin page that may answer an anonymous request: it is where anonymous requests end. */
export const ANONYMOUS_ALLOWLIST = ['admin/acceso/page.tsx'];

/**
 * Admin files whose `generate*` exports may answer an anonymous request. The
 * admin root layout's metadata is static copy (a title and noindex, no data) and
 * also serves the sign-in page, so it cannot be guarded. Nothing that reads data belongs here.
 */
export const METADATA_ALLOWLIST = ['admin/layout.tsx'];

/** Next.js exports that run before or beside the page body and so are server entry points of the route. */
export const GENERATE_EXPORTS = ['generateMetadata', 'generateViewport', 'generateStaticParams'] as const;

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export type AnonymousAnswer =
  | { kind: 'redirect'; to: string }
  | { kind: 'refused'; status: number }
  | { kind: 'content'; detail: string }
  | { kind: 'threw'; message: string };

function redirectTo(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== 'string') return null;
  const [marker, , to] = digest.split(';');
  return marker === 'NEXT_REDIRECT' ? to : null;
}

/** A page answered an anonymous request: only a redirect to the sign-in page is acceptable. */
export async function answerPage(file: string): Promise<AnonymousAnswer> {
  const mod = (await import(/* @vite-ignore */ file)) as { default?: (props: unknown) => unknown };
  if (typeof mod.default !== 'function') return { kind: 'content', detail: 'no default export' };
  try {
    await mod.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}) });
  } catch (error) {
    const to = redirectTo(error);
    if (to !== null) return { kind: 'redirect', to };
    return { kind: 'threw', message: error instanceof Error ? error.name : 'non-error' };
  }
  return { kind: 'content', detail: 'rendered' };
}

/**
 * Each `generate*` export of a page or layout, called anonymously the way Next
 * resolves metadata (before the page body). Keys are the export names that
 * exist; a missing export is simply absent.
 */
export async function answerGenerators(file: string): Promise<Record<string, AnonymousAnswer>> {
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  const answers: Record<string, AnonymousAnswer> = {};
  for (const name of GENERATE_EXPORTS) {
    const generator = mod[name];
    if (typeof generator !== 'function') continue;
    try {
      await generator({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }, Promise.resolve({}));
      answers[name] = { kind: 'content', detail: `${name} returned` };
    } catch (error) {
      const to = redirectTo(error);
      answers[name] =
        to !== null ? { kind: 'redirect', to } : { kind: 'threw', message: error instanceof Error ? error.name : 'non-error' };
    }
  }
  return answers;
}

/** A route handler answered an anonymous request: each exported method must refuse. */
export async function answerHandlers(file: string): Promise<AnonymousAnswer[]> {
  const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
  const answers: AnonymousAnswer[] = [];
  for (const method of HTTP_METHODS) {
    const handler = mod[method];
    if (typeof handler !== 'function') continue;
    try {
      const response = (await handler(new Request('http://127.0.0.1:3000/admin/x', { method }), {
        params: Promise.resolve({}),
      })) as Response;
      const status = response.status;
      const refused = status === 401 || status === 403 || status === 404 || (status >= 300 && status < 400);
      const bodyText = await response.text();
      if (refused && bodyText === '' && !response.headers.has('set-cookie')) {
        answers.push({ kind: 'refused', status });
      } else {
        answers.push({ kind: 'content', detail: `${method} answered ${status}` });
      }
    } catch (error) {
      const to = redirectTo(error);
      answers.push(to !== null ? { kind: 'redirect', to } : { kind: 'threw', message: String(error) });
    }
  }
  return answers;
}

/** Whether an anonymous answer is one that reveals nothing and does nothing. */
export function isRefusal(answer: AnonymousAnswer): boolean {
  if (answer.kind === 'redirect') return answer.to.startsWith('/admin/acceso');
  return answer.kind === 'refused';
}

/**
 * Every admin page or route handler under `appDir` (an `app` directory, posix
 * names relative to it) that answers an anonymous request with anything but a
 * refusal. An empty list is the pass.
 */
export async function findUnguardedAdminRoutes(
  appDir: string,
  allowlist: string[] = ANONYMOUS_ALLOWLIST,
  metadataAllowlist: string[] = METADATA_ALLOWLIST,
): Promise<string[]> {
  const unguarded: string[] = [];
  for (const relative of listRouteFiles(appDir)) {
    if (classifyRoute(relative) !== 'admin' || allowlist.includes(relative)) continue;
    const absolute = path.join(appDir, relative);
    const answers = /^(page)\./.test(path.basename(relative))
      ? [await answerPage(absolute)]
      : await answerHandlers(absolute);
    if (answers.length === 0 || !answers.every(isRefusal)) unguarded.push(relative);
  }
  // CR-2: generateMetadata and friends run without the page body, so each needs
  // the check itself. Layouts count too; the sign-in page is covered by the allow-list above.
  for (const relative of listLayoutAndPageFiles(appDir)) {
    if (classifyRoute(relative) !== 'admin' || allowlist.includes(relative) || metadataAllowlist.includes(relative)) {
      continue;
    }
    const answers = await answerGenerators(path.join(appDir, relative));
    for (const [name, answer] of Object.entries(answers)) {
      if (!isRefusal(answer)) unguarded.push(`${relative}#${name}`);
    }
  }
  return unguarded.sort();
}

const GENERATOR_HOLDER = /^(page|layout)\.(ts|tsx|js|jsx|mdx)$/;

/** Every `page.*` / `layout.*` file under `appDir`, posix paths relative to it. */
export function listLayoutAndPageFiles(appDir: string): string[] {
  return walk(appDir)
    .filter((full) => GENERATOR_HOLDER.test(path.basename(full)))
    .map((full) => path.relative(appDir, full).split(path.sep).join('/'))
    .sort();
}

// ---------------------------------------------------------------------------
// Server actions

const ACTION_FILE = /\.(ts|tsx)$/;
const BEFORE_THE_GUARD = /\b(await|return|insert|update|delete|if|for|while|try|throw|getDb|fetch)\b|\bdb\./;

/** Actions that are public by design: they are how an anonymous visitor becomes an admin, or leaves. */
export const PUBLIC_ACTIONS = new Set(['signInAction', 'signOutAction']);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

/** Every source file under `dir` (posix path relative to `root`) whose code carries a `use server` directive. */
export function filesWithServerActions(root: string, dir: string): { file: string; code: string }[] {
  return walk(path.join(root, dir))
    .filter((full) => ACTION_FILE.test(full))
    .map((full) => ({
      file: path.relative(root, full).split(path.sep).join('/'),
      code: stripComments(readFileSync(full, 'utf8')),
    }))
    .filter(({ code }) => /['"]use server['"]/.test(code));
}

/**
 * Exported actions in `code` that do not start with the role check: the text
 * before the first `requireAdminAction(` must hold no statement, and the check's
 * result must be narrowed with `isAdminRefusal`. Returns `file:name` entries.
 */
export function unguardedActions(file: string, code: string): string[] {
  const found: string[] = [];
  const pattern = /export\s+(?:async\s+)?function\s+(\w+)\s*\(|export\s+const\s+(\w+)\s*=\s*async\b/g;
  const starts = [...code.matchAll(pattern)];
  starts.forEach((match, index) => {
    const name = match[1] ?? match[2];
    if (PUBLIC_ACTIONS.has(name)) return;
    const end = starts[index + 1]?.index ?? code.length;
    const chunk = code.slice(match.index + match[0].length, end);
    const guardAt = chunk.indexOf('requireAdminAction(');
    // The call may be written `const who = await requireAdminAction()`: that
    // await belongs to the guard, anything else before it is a statement.
    const before =
      guardAt < 0 ? '' : chunk.slice(0, guardAt).replace(/(?:(?:const|let)\s+\w+\s*=\s*)?await\s+$/, '');
    const guarded = guardAt >= 0 && !BEFORE_THE_GUARD.test(before) && /isAdminRefusal\(/.test(chunk);
    if (!guarded) found.push(`${file}:${name}`);
  });
  return found;
}
