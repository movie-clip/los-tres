import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Guardrail 2 (no scraping) and TD-17 (relative imports in server-side code)
// are lint rules, so a regression would be silent. These lint virtual files
// with the repo's real eslint.config.mjs. The relative-import override in
// src/{cli,config,db,server} must repeat the scraping-library ban, because
// flat-config options do not merge; the first block pins that.

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImports(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.resolve(process.cwd(), file) });
  return result.messages
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

const TIMEOUT = 60_000;

describe('scraping-library ban (guardrail 2, TD-10)', () => {
  const banned = ['cheerio', 'puppeteer', '@playwright/test', 'jsdom', 'playwright-core'];
  const places = [
    'src/server/x.ts',
    'src/cli/x.ts',
    'src/db/x.ts',
    'src/config/x.ts',
    'src/app/x.tsx',
    'src/components/x.tsx',
    'scripts/x.mjs',
  ];

  for (const place of places) {
    it.each(banned)(`flags %s imported in ${place}`, async (library) => {
      const messages = await restrictedImports(place, `import lib from '${library}';\nexport default lib;\n`);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.join(' ')).toContain('Guardrail 2');
    }, TIMEOUT);
  }

  it('allows the Playwright runner in tests/, which is outside the ban', async () => {
    const messages = await restrictedImports(
      'tests/e2e/x.spec.ts',
      `import { test } from '@playwright/test';\nexport { test };\n`,
    );
    expect(messages).toEqual([]);
  }, TIMEOUT);
});

describe('relative-import rule for server-side directories (TD-17)', () => {
  it.each(['src/server/x.ts', 'src/cli/x.ts', 'src/db/x.ts', 'src/config/x.ts'])(
    'flags an @/ import in %s',
    async (file) => {
      const messages = await restrictedImports(file, `import { getDb } from '@/db/client';\nexport { getDb };\n`);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.join(' ')).toContain('import relatively');
    },
    TIMEOUT,
  );

  it('allows an @/ import in the app and in components', async () => {
    for (const file of ['src/app/x.tsx', 'src/components/x.tsx']) {
      const messages = await restrictedImports(file, `import { getDb } from '@/db/client';\nexport { getDb };\n`);
      expect(messages).toEqual([]);
    }
  }, TIMEOUT);

  it('allows a relative import in src/server', async () => {
    const messages = await restrictedImports(
      'src/server/x.ts',
      `import { getDb } from '../db/client';\nexport { getDb };\n`,
    );
    expect(messages).toEqual([]);
  }, TIMEOUT);
});
