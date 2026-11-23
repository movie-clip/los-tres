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

// Time in tests (0006, rules 1 and 2): the unit, integration and support files read
// no clock, so the gate does not depend on how loaded the machine is. A real timing
// lives in tests/timing, which the block does not cover, and e2e is out of the rule.
describe('clock reads in tests (0006, time in tests, rules 1 and 2)', () => {
  async function clockMessages(file: string, code: string) {
    const [result] = await eslint.lintText(code, { filePath: path.resolve(process.cwd(), file) });
    return result.messages;
  }
  async function clockReads(file: string, code: string): Promise<string[]> {
    return (await clockMessages(file, code))
      .filter((message) => message.ruleId === 'no-restricted-syntax')
      .map((message) => message.message);
  }

  const forms = [
    ['Date.now()', 'Date.now()'],
    ['performance.now()', 'performance.now()'],
    ['process.hrtime()', 'process.hrtime()'],
    ['process.hrtime.bigint()', 'process.hrtime.bigint()'],
    ['process.uptime()', 'process.uptime()'],
    ['new Date() with no argument', 'new Date()'],
    ['Date.now taken as a reference', 'Date.now'],
  ] as const;
  const allForms = forms.map(([, expression], index) => `export const v${index} = ${expression};\n`).join('');
  const covered = ['tests/unit/x.test.ts', 'tests/integration/x.test.ts', 'tests/support/x.ts'];
  const outside = ['tests/timing/x.timing.test.ts', 'tests/e2e/x.spec.ts'];

  for (const place of covered) {
    it.each(forms)(`flags %s in ${place}`, async (_name, expression) => {
      const messages = await clockReads(place, `export const t = ${expression};\n`);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('0006');
      expect(messages[0]).toContain('-- clock:');
    }, TIMEOUT);
  }

  for (const place of outside) {
    it(`flags none of them in ${place}, which the block does not cover`, async () => {
      expect(await clockReads(place, allForms)).toEqual([]);
    }, TIMEOUT);
  }

  it('flags every form at once where the block applies, so the check above is not blind', async () => {
    expect(await clockReads('tests/unit/x.test.ts', allForms)).toHaveLength(forms.length);
  }, TIMEOUT);

  it('does not flag a fixed instant, a date built from an argument or a fake clock call', async () => {
    const code = [
      "export const a = new Date('2026-01-01T00:00:00Z');",
      'export const b = new Date(0);',
      'export const c = new Date(1_000);',
      'export const d = Date.parse("2026-01-01T00:00:00Z");',
      "vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'));",
      '',
    ].join('\n');
    for (const place of covered) expect(await clockReads(place, code), place).toEqual([]);
  }, TIMEOUT);

  it('lets a line through that has the next-line directive with a clock reason, and only that line', async () => {
    const code = [
      '// eslint-disable-next-line no-restricted-syntax -- clock: a stored time is compared within a one minute window',
      'export const allowed = Date.now();',
      'export const refused = Date.now();',
      '',
    ].join('\n');
    for (const place of covered) {
      const messages = await clockMessages(place, code);
      expect(messages.map((message) => message.line), place).toEqual([3]);
    }
  }, TIMEOUT);

  it('reports a directive that suppresses nothing, so a stale one cannot stay behind', async () => {
    const code = [
      '// eslint-disable-next-line no-restricted-syntax -- clock: this line reads no clock any more',
      'export const fixed = 1;',
      '',
    ].join('\n');
    const messages = await clockMessages('tests/integration/x.test.ts', code);
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBeNull();
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain('Unused eslint-disable directive');
  }, TIMEOUT);
});
