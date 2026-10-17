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
    'node_modules/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
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
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
]);
