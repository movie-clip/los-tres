import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Guardrail 2 (no scraping): libraries whose only job is to read a shop's
// HTML or to drive a browser are banned from app and script code (TD-10).
// Feed XML parsing is not on this list.
const scrapingLibraries = [
  'cheerio',
  'jsdom',
  'linkedom',
  'parse5',
  'node-html-parser',
  'htmlparser2',
  'puppeteer',
  'puppeteer-*',
  'playwright',
  'playwright-*',
  '@playwright/*',
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'node_modules/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
    // Scratch scripts of agent runs (screenshots, measurements) are not product code.
    'agentic/runs/**',
  ]),
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs,ts}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: scrapingLibraries,
              message:
                'Guardrail 2: data enters only through a registered feed. No crawler, headless browser or HTML parser for shop pages.',
            },
          ],
        },
      ],
    },
  },
  {
    // The CLI is compiled by tsc, which does not rewrite the `@/` alias, so the
    // server-side directories import each other relatively (TD-17). Flat-config
    // options do not merge: this block must repeat the scraping-library ban
    // above or the override silently drops guardrail 2 for these files.
    files: ['src/{cli,config,db,server}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: scrapingLibraries,
              message:
                'Guardrail 2: data enters only through a registered feed. No crawler, headless browser or HTML parser for shop pages.',
            },
            {
              group: ['@/*'],
              message:
                'src/cli, src/config, src/db and src/server import relatively: tsc does not rewrite the @/ alias in the compiled CLI.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    // Time in tests (decision 0006, rules 1 and 2): the gate's result must not
    // depend on how fast or how loaded the machine is, so a unit, integration
    // or support file reads no clock. tests/timing and tests/e2e are outside
    // this block on purpose: a real timing belongs in tests/timing, and the e2e
    // project is not covered by the rule. Member selectors, not call selectors,
    // so `const now = Date.now` is caught too. The only escape is the
    // next-line directive with a `clock:` reason, which
    // tests/unit/gate-determinism.test.ts holds to that exact form.
    files: ['tests/unit/**/*.ts', 'tests/integration/**/*.ts', 'tests/support/**/*.ts'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          "MemberExpression[object.name='Date'][property.name='now']",
          "MemberExpression[object.name='performance'][property.name='now']",
          "MemberExpression[object.name='process'][property.name=/^(hrtime|uptime)$/]",
          "NewExpression[callee.name='Date'][arguments.length=0]",
        ].map((selector) => ({
          selector,
          message:
            'Time in tests (0006, rule 1): a unit or integration test does not read the clock. Use a fixed instant or fake timers; a real timing belongs in tests/timing. To compare a stored time with the present, mark the line: // eslint-disable-next-line no-restricted-syntax -- clock: <why load cannot reach it>',
        })),
      ],
    },
  },
]);
