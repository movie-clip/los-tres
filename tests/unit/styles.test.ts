import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Static guard for the S11.1 styling rules (decision D-4, 0011). It reads CSS
// text from disk, so it needs neither a database nor a build. Comments are
// scanned too, because the integration grep reads them.

const root = process.cwd();
const GLOBALS = 'src/app/globals.css';

interface CssFile {
  file: string;
  text: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function srcCss(): CssFile[] {
  return walk(path.join(root, 'src'))
    .filter((full) => full.endsWith('.css'))
    .map((full) => ({
      file: path.relative(root, full).split(path.sep).join('/'),
      text: readFileSync(full, 'utf8'),
    }));
}

const isModule = (file: string) => file.endsWith('.module.css');

/** The text of every `:root { ... }` block, and the text with those blocks blanked out (line count kept). */
function splitRoot(text: string): { rootBody: string; outside: string } {
  let rootBody = '';
  let outside = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(':root', i);
    if (start === -1) {
      outside += text.slice(i);
      break;
    }
    const open = text.indexOf('{', start);
    const close = open === -1 ? -1 : text.indexOf('}', open);
    if (open === -1 || close === -1) {
      outside += text.slice(i);
      break;
    }
    outside += text.slice(i, start) + text.slice(start, close + 1).replace(/[^\n]/g, ' ');
    rootBody += text.slice(open + 1, close) + '\n';
    i = close + 1;
  }
  return { rootBody, outside };
}

interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function scan(files: CssFile[], rule: string, pattern: RegExp, applies: (file: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const { file, text } of files) {
    if (!applies(file)) continue;
    text.split(/\r?\n/).forEach((lineText, index) => {
      if (pattern.test(lineText)) hits.push({ file, line: index + 1, rule, text: lineText.trim() });
    });
  }
  return hits;
}

const FORBIDDEN_PROPERTIES: [string, RegExp][] = [
  ['box-shadow', /box-shadow/i],
  ['transition', /transition/i],
  ['transform', /transform/i],
  ['animation', /animation|@keyframes/i],
  ['100vw', /100vw/i],
];
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i;

/** Rules 1 and 2: no motion, shadow or viewport-width, anywhere; no raw colour outside :root. */
function styleViolations(files: CssFile[]): Hit[] {
  const hits = FORBIDDEN_PROPERTIES.flatMap(([rule, pattern]) => scan(files, rule, pattern, () => true));
  const outsideRoot = files.map(({ file, text }) => ({ file, text: splitRoot(text).outside }));
  return hits.concat(scan(outsideRoot, 'raw colour', RAW_COLOUR, () => true));
}

/** Names defined as custom properties in the :root blocks of the globals file. */
function definedTokens(globals: string): Set<string> {
  const names = new Set<string>();
  for (const match of splitRoot(globals).rootBody.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
  return names;
}

/** Rule 3: every `var(--x)` read in any css names a token defined in globals :root. */
function undefinedTokenReads(files: CssFile[], globals: string): Hit[] {
  const defined = definedTokens(globals);
  const hits: Hit[] = [];
  for (const { file, text } of files) {
    text.split(/\r?\n/).forEach((lineText, index) => {
      for (const match of lineText.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!defined.has(match[1])) {
          hits.push({ file, line: index + 1, rule: 'undefined token', text: match[1] });
        }
      }
    });
  }
  return hits;
}

const describeHits = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`);

describe('S11.1 styling rules on the real stylesheets', () => {
  const files = srcCss();
  const globals = files.find((f) => f.file === GLOBALS);

  it('finds the stylesheets, so the scans cannot go vacuous', () => {
    expect(globals).toBeDefined();
    expect(files.filter((f) => isModule(f.file)).length).toBeGreaterThanOrEqual(10);
    expect(definedTokens(globals?.text ?? '').size).toBeGreaterThan(10);
  });

  it('has no box-shadow, transition, transform, animation or 100vw in any css under src', () => {
    const hits = FORBIDDEN_PROPERTIES.flatMap(([rule, pattern]) => scan(files, rule, pattern, () => true));
    expect(describeHits(hits)).toEqual([]);
  });

  it('has no hex, rgb() or hsl() colour in any module, and none outside :root in globals', () => {
    const hits = styleViolations(files).filter((h) => h.rule === 'raw colour');
    expect(describeHits(hits)).toEqual([]);
  });

  it('reads only custom properties that globals :root defines', () => {
    expect(describeHits(undefinedTokenReads(files, globals?.text ?? ''))).toEqual([]);
  });
});

describe('S11.1 style rules fail on a broken stylesheet (in-memory cases)', () => {
  const globals = ':root {\n  --color-ink: #111;\n  --space-1: 0.25rem;\n}\nbody { margin: 0; }\n';
  const modCss = (text: string): CssFile[] => [{ file: 'src/components/Fake.module.css', text }];

  it('accepts a module that uses only tokens', () => {
    const css = modCss('.a {\n  color: var(--color-ink);\n  padding: var(--space-1);\n  width: 100%;\n}\n');
    expect(styleViolations(css)).toEqual([]);
    expect(undefinedTokenReads(css, globals)).toEqual([]);
  });

  it.each([
    ['box-shadow', '.a {\n  box-shadow: 0 0 2px black;\n}\n'],
    ['transition', '.a {\n  transition: color 0.2s;\n}\n'],
    ['transform', '.a {\n  transform: rotate(45deg);\n}\n'],
    ['animation', '.a {\n  animation: spin 1s;\n}\n'],
    ['100vw', '.a {\n  width: 100vw;\n}\n'],
  ])('flags %s, with file and line', (rule, css) => {
    const hits = styleViolations(modCss(css));
    expect(hits).toEqual([expect.objectContaining({ file: 'src/components/Fake.module.css', line: 2, rule })]);
  });

  it('flags a forbidden word inside a comment', () => {
    const hits = styleViolations(modCss('/* no box-shadow here */\n.a { color: var(--color-ink); }\n'));
    expect(hits.map((h) => h.rule)).toEqual(['box-shadow']);
  });

  it.each([
    ['hex 3', '#abc'],
    ['hex 6', '#3b414a'],
    ['hex 8', '#3b414aff'],
    ['rgb', 'rgb(0, 0, 0)'],
    ['rgba', 'rgba(0, 0, 0, 0.5)'],
    ['hsl', 'hsl(10 20% 30%)'],
  ])('flags a %s colour in a module', (_name, colour) => {
    const hits = styleViolations(modCss(`.a {\n  color: ${colour};\n}\n`));
    expect(hits).toEqual([expect.objectContaining({ line: 2, rule: 'raw colour' })]);
  });

  it('allows a raw colour inside :root and flags one in globals outside :root', () => {
    const ok = [{ file: GLOBALS, text: globals }];
    expect(styleViolations(ok)).toEqual([]);
    const bad = [{ file: GLOBALS, text: `${globals}a { color: #fff; }\n` }];
    expect(styleViolations(bad).map((h) => [h.line, h.rule])).toEqual([[6, 'raw colour']]);
  });

  it('flags a var() with no :root definition and a typo of a real token', () => {
    const css = modCss('.a {\n  color: var(--color-inkk);\n  padding: var(--space-9, 1px);\n}\n');
    const hits = undefinedTokenReads(css, globals);
    expect(hits.map((h) => [h.line, h.text])).toEqual([
      [2, '--color-inkk'],
      [3, '--space-9'],
    ]);
  });

  it('does not count a token defined outside :root as defined', () => {
    const outside = ':root {\n  --a: 1;\n}\n.x {\n  --b: 2;\n}\n';
    expect([...definedTokens(outside)]).toEqual(['--a']);
  });
});
