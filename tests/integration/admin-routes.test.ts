import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/db/client';

import {
  ANONYMOUS_ALLOWLIST,
  METADATA_ALLOWLIST,
  answerGenerators,
  answerPage,
  filesWithServerActions,
  findUnguardedAdminRoutes,
  unguardedActions,
} from '../support/admin-routes';
import { nextRequest, startRequest } from '../support/next-request';
import { classifyRoute, listRouteFiles } from '../support/routes';

// Guardrail 3, AC 22: every admin page, route handler and server action refuses
// an anonymous request, found from the route classification and not from a list
// somebody keeps. A deliberately unguarded fixture proves the check can fail.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);

const root = process.cwd();
const appDir = path.resolve(root, 'src/app');
const fixtures = path.resolve(root, 'tests/fixtures/admin-routes');

beforeEach(() => {
  startRequest();
});
afterAll(async () => {
  await closeDb();
});

describe('every admin route refuses an anonymous request (AC 17, AC 18, AC 22)', () => {
  const adminRoutes = listRouteFiles(appDir).filter((file) => classifyRoute(file) === 'admin');

  it('finds the admin routes that exist, so the check below is not vacuous', () => {
    expect(adminRoutes).toEqual(expect.arrayContaining(['admin/acceso/page.tsx', 'admin/(shell)/page.tsx']));
  });

  it('allow-lists exactly the sign-in page', () => {
    expect(ANONYMOUS_ALLOWLIST).toEqual(['admin/acceso/page.tsx']);
  });

  it('answers each admin route, except the sign-in page, with a redirect to sign-in or a refusal', async () => {
    expect(await findUnguardedAdminRoutes(appDir)).toEqual([]);
  });

  it('sends the shell page to the sign-in page, naming why', async () => {
    const answer = await answerPage(path.join(appDir, 'admin/(shell)/page.tsx'));
    expect(answer).toEqual({ kind: 'redirect', to: '/admin/acceso?aviso=sesion' });
  });

  it('sends the shell layout to the sign-in page too, before any chrome is built', async () => {
    const answer = await answerPage(path.join(appDir, 'admin/(shell)/layout.tsx'));
    expect(answer).toEqual({ kind: 'redirect', to: '/admin/acceso?aviso=sesion' });
  });

  it('sends the shell page generateMetadata to the sign-in page, so metadata never reads data first', async () => {
    const answers = await answerGenerators(path.join(appDir, 'admin/(shell)/page.tsx'));
    expect(answers.generateMetadata).toEqual({ kind: 'redirect', to: '/admin/acceso?aviso=sesion' });
  });

  it('sets no cookie while refusing', async () => {
    await findUnguardedAdminRoutes(appDir);
    expect(nextRequest.cookieWrites).toEqual([]);
  });
});

describe('the enumerator itself can fail (AC 22)', () => {
  it('reports a deliberately unguarded admin page and route handler', async () => {
    const found = await findUnguardedAdminRoutes(path.join(fixtures, 'unguarded'));
    expect(found).toEqual(['admin/leak-handler/route.ts', 'admin/leak/page.tsx']);
  });

  it('reports an admin page whose generateMetadata runs without the role check, though its body is guarded', async () => {
    const found = await findUnguardedAdminRoutes(path.join(fixtures, 'unguarded-metadata'));
    expect(found).toEqual(['admin/leak-meta/page.tsx#generateMetadata']);
  });

  it('allow-lists only the static admin root layout for metadata', () => {
    expect(METADATA_ALLOWLIST).toEqual(['admin/layout.tsx']);
  });

  it('passes a guarded admin page and a route handler that answers 401', async () => {
    expect(await findUnguardedAdminRoutes(path.join(fixtures, 'guarded'))).toEqual([]);
  });

  it('reports the sign-in page when it is not allow-listed, since it answers an anonymous request', async () => {
    const found = await findUnguardedAdminRoutes(appDir, []);
    expect(found).toContain('admin/acceso/page.tsx');
  });
});

describe('every admin server action starts with the role check (AC 18, AC 22)', () => {
  const GUARDED = `
    'use server';
    export async function saveFeed(form: FormData) {
      const who = await requireAdminAction();
      if (isAdminRefusal(who)) return who;
      return write(form);
    }
    export const hideProduct = async (id: number) => {
      const who = await requireAdminAction();
      if (isAdminRefusal(who)) return who;
      return id;
    };
  `;

  it('accepts the call-and-narrow shape the design fixes', () => {
    expect(unguardedActions('f.ts', GUARDED)).toEqual([]);
  });

  it('reports an action with no check', () => {
    const code = `'use server'; export async function wipe() { await db.delete(offers); }`;
    expect(unguardedActions('f.ts', code)).toEqual(['f.ts:wipe']);
  });

  it('reports an action that writes before it checks', () => {
    const code = `
      'use server';
      export async function late() {
        await db.delete(offers);
        const who = await requireAdminAction();
        if (isAdminRefusal(who)) return who;
      }`;
    expect(unguardedActions('f.ts', code)).toEqual(['f.ts:late']);
  });

  it('reports an action that checks but never acts on the refusal', () => {
    const code = `'use server'; export async function ignore() { await requireAdminAction(); return 1; }`;
    expect(unguardedActions('f.ts', code)).toEqual(['f.ts:ignore']);
  });

  it('reports only the unguarded one when two actions share a file', () => {
    const code = `${GUARDED}\n export async function sneaky() { return 1; }`;
    expect(unguardedActions('f.ts', code)).toEqual(['f.ts:sneaky']);
  });

  it('holds for every server action in the app, and sign-in and sign-out are the only public ones', () => {
    const files = filesWithServerActions(root, 'src');
    expect(files.map(({ file }) => file)).toEqual(expect.arrayContaining(['src/server/auth/actions.ts']));
    const unguarded = files.flatMap(({ file, code }) => unguardedActions(file, code));
    expect(unguarded).toEqual([]);
  });

  it('keeps server actions to the admin code: none sits in a public page or component', () => {
    const outside = filesWithServerActions(root, 'src')
      .map(({ file }) => file)
      .filter(
        (file) =>
          !file.startsWith('src/server/auth/') &&
          !file.startsWith('src/app/admin/') &&
          !file.startsWith('src/components/admin/'),
      );
    expect(outside).toEqual([]);
  });
});
