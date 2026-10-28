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
]);
