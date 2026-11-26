import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Static guard for the S11.1 styling rules (decision D-4, 0011) and the #398 token sets. It reads CSS
// text from disk, so it needs neither a database nor a build. Comments are scanned too, because the
// integration grep reads them.

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

/** The text with every comment blanked, newlines and offsets kept, so structure can be read from it. */
const blankComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

/** One spacing and one quote style, so a selector compares by its meaning. */
const squash = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().replace(/\s*,\s*/g, ', ').replace(/"/g, "'");

interface Block {
  selector: string;
  /** The selectors of the enclosing rules, outermost first (an at-rule is one). */
  parents: string[];
  body: string;
  /** Offsets of the body in the text: after `{`, and at `}`. */
  start: number;
  end: number;
}

/** Every `{ ... }` block of a stylesheet, nested ones included. */
function blocks(text: string): Block[] {
  const bare = blankComments(text);
  const found: Block[] = [];
  const open: { selector: string; start: number }[] = [];
  let boundary = 0;
  for (let i = 0; i < bare.length; i++) {
    const ch = bare[i];
    if (ch === '{') {
      open.push({ selector: squash(bare.slice(boundary, i)), start: i + 1 });
      boundary = i + 1;
    } else if (ch === '}') {
      const top = open.pop();
      if (top !== undefined) {
        found.push({
          selector: top.selector,
          parents: open.map((entry) => entry.selector),
          body: bare.slice(top.start, i),
          start: top.start,
          end: i,
        });
      }
      boundary = i + 1;
    } else if (ch === ';') {
      boundary = i + 1;
    }
  }
  return found;
}

// The three token blocks of globals.css (#398), by what they select, never by position.
const LIGHT_SELECTOR = ':root';
const DARK_SELECTOR = ":root[data-theme='dark'], [data-theme='dark']";
const MEDIA_PARENT = '@media (prefers-color-scheme: dark)';
const MEDIA_SELECTOR = ':root:not([data-theme])';

type SetName = 'light' | 'dark' | 'media';
const SET_NAMES: SetName[] = ['light', 'dark', 'media'];

function tokenBlocks(text: string): Record<SetName, Block[]> {
  const all = blocks(text);
  return {
    light: all.filter((b) => b.selector === LIGHT_SELECTOR && b.parents.length === 0),
    dark: all.filter((b) => b.selector === DARK_SELECTOR && b.parents.length === 0),
    media: all.filter((b) => b.selector === MEDIA_SELECTOR && b.parents.join('|') === MEDIA_PARENT),
  };
}

/** The text with the body of each token block blanked (line count kept): what a raw colour may not touch. */
function outsideTokenBlocks(text: string): string {
  const found = tokenBlocks(text);
  const ranges = SET_NAMES.flatMap((name) => found[name]).sort((a, b) => a.start - b.start);
  let outside = '';
  let at = 0;
  for (const block of ranges) {
    outside += text.slice(at, block.start) + text.slice(block.start, block.end).replace(/[^\n]/g, ' ');
    at = block.end;
  }
  return outside + text.slice(at);
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

/** Rules 1 and 2: no motion, shadow or viewport-width, anywhere; no raw colour outside the token blocks of globals. */
function styleViolations(files: CssFile[]): Hit[] {
  const hits = FORBIDDEN_PROPERTIES.flatMap(([rule, pattern]) => scan(files, rule, pattern, () => true));
  const outside = files.map(({ file, text }) => ({ file, text: file === GLOBALS ? outsideTokenBlocks(text) : text }));
  return hits.concat(scan(outside, 'raw colour', RAW_COLOUR, () => true));
}

interface TokenSet {
  declarations: [string, string][];
  scheme: string | null;
}

function readSet(block: Block): TokenSet {
  const declarations = [...block.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    (match): [string, string] => [match[1], squash(match[2])],
  );
  const scheme = /(?:^|[;\s])color-scheme\s*:\s*([^;]+);/.exec(block.body)?.[1].trim() ?? null;
  return { declarations, scheme };
}

/** Names defined as custom properties in the light `:root` block of the globals file. */
function definedTokens(globals: string): Set<string> {
  const names = new Set<string>();
  for (const block of tokenBlocks(globals).light) {
    for (const [name] of readSet(block).declarations) names.add(name);
  }
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

  it('has no hex, rgb() or hsl() colour in any module, and none outside the three token blocks in globals', () => {
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

  it('flags a hex-looking issue reference in a comment of a module', () => {
    const hits = styleViolations(modCss('/* issue #398 */\n.a { color: var(--color-ink); }\n'));
    expect(hits.map((h) => h.rule)).toEqual(['raw colour']);
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

// #398: the light set in :root, the dark set twice (on the attribute, and under the media query for a
// page with no script). These are the rules that keep the two copies one set and the aliases honest.

/** The nine tokens #398 adds: five colours (in all three sets) and four that are no colour. */
const NEW_TOKENS = [
  '--color-frame',
  '--color-on-frame',
  '--color-on-frame-muted',
  '--color-on-frame-line',
  '--color-scrim',
  '--font-display',
  '--font-mono',
  '--elevation-1',
  '--elevation-2',
];

const EXPECTED_SCHEME: Record<SetName, string> = { light: 'light', dark: 'dark', media: 'dark' };

/** What is wrong with the three token blocks of a stylesheet, one line per problem; empty when they hold. */
function themeProblems(text: string, required: string[]): string[] {
  const problems: string[] = [];
  const found = tokenBlocks(text);
  const sets: Partial<Record<SetName, TokenSet>> = {};
  for (const name of SET_NAMES) {
    if (found[name].length === 1) sets[name] = readSet(found[name][0]);
    else problems.push(`${found[name].length === 0 ? 'missing' : 'duplicate'} block: ${name}`);
  }
  const { light, dark, media } = sets;
  if (light === undefined || dark === undefined || media === undefined) return problems;

  for (const name of SET_NAMES) {
    const scheme = sets[name]?.scheme ?? null;
    if (scheme !== EXPECTED_SCHEME[name]) problems.push(`color-scheme of ${name} is ${scheme}`);
  }

  const colours = (set: TokenSet) => set.declarations.map(([name]) => name).filter((name) => name.startsWith('--color-'));
  for (const [name, set] of [['dark', dark], ['media', media]] as const) {
    for (const token of colours(light)) {
      if (!colours(set).includes(token)) problems.push(`${name} lacks the colour token ${token}`);
    }
    for (const token of colours(set)) {
      if (!colours(light).includes(token)) problems.push(`${name} has ${token}, which light lacks`);
    }
  }

  const darkLines = dark.declarations.map(([name, value]) => `${name}: ${value}`);
  const mediaLines = media.declarations.map(([name, value]) => `${name}: ${value}`);
  if (darkLines.join('\n') !== mediaLines.join('\n')) {
    const changed = [
      ...darkLines.filter((line) => !mediaLines.includes(line)).map((line) => `media lacks ${line}`),
      ...mediaLines.filter((line) => !darkLines.includes(line)).map((line) => `media adds ${line}`),
    ];
    problems.push(`media differs from dark: ${changed.join('; ') || 'order or a repeated line'}`);
  }

  // An alias is computed where it is declared, so a dark block that does not declare it again leaves the
  // light ink on the admin wrapper.
  for (const [name, value] of light.declarations) {
    if (!value.includes('var(--color-')) continue;
    const again = dark.declarations.find(([darkName]) => darkName === name);
    if (again === undefined) problems.push(`alias ${name} is not declared again in dark`);
    else if (!again[1].includes('var(')) problems.push(`alias ${name} is a literal in dark`);
  }

  for (const token of required) {
    if (!light.declarations.some(([name]) => name === token)) problems.push(`new token missing in light: ${token}`);
  }
  return problems;
}

describe('#398 the three token blocks of globals.css', () => {
  const globals = srcCss().find((f) => f.file === GLOBALS)?.text ?? '';

  it('finds exactly one light, one dark and one media block, each with declarations', () => {
    const found = tokenBlocks(globals);
    for (const name of SET_NAMES) {
      expect(found[name], name).toHaveLength(1);
      expect(readSet(found[name][0]).declarations.length, name).toBeGreaterThan(10);
    }
  });

  it('holds: one colour token list in all three, the media copy equal to the dark block, every alias redeclared, the schemes declared', () => {
    expect(themeProblems(globals, NEW_TOKENS)).toEqual([]);
  });

  it('defines the nine new tokens', () => {
    const light = readSet(tokenBlocks(globals).light[0]).declarations.map(([name]) => name);
    expect(NEW_TOKENS.filter((name) => !light.includes(name))).toEqual([]);
  });

  it('fills the admin wrapper with the canvas and text tokens, because the body reads the root and not the wrapper', () => {
    const wrapper = readFileSync(path.join(root, 'src/app/admin/layout.module.css'), 'utf8');
    expect(wrapper).toMatch(/\.scheme\s*\{[^}]*background:\s*var\(--color-canvas\);/);
    expect(wrapper).toMatch(/\.scheme\s*\{[^}]*color:\s*var\(--color-text\);/);
  });

  it('names the same colour tokens in the dark block as in the light block, so every light colour has a dark value', () => {
    const sets = tokenBlocks(globals);
    const names = (name: SetName) =>
      readSet(sets[name][0]).declarations.map(([token]) => token).filter((token) => token.startsWith('--color-'));
    expect(names('dark').sort()).toEqual(names('light').sort());
    expect(names('media').sort()).toEqual(names('light').sort());
    expect(names('light').length).toBeGreaterThan(30);
  });

  it('redeclares every alias of the light block (a value reading --color-*) in the dark block', () => {
    const sets = tokenBlocks(globals);
    const aliases = readSet(sets.light[0])
      .declarations.filter(([, value]) => value.includes('var(--color-'))
      .map(([name]) => name);
    expect(aliases.length).toBeGreaterThanOrEqual(5);
    const dark = readSet(sets.dark[0]).declarations.map(([name]) => name);
    expect(aliases.filter((name) => !dark.includes(name))).toEqual([]);
  });
});

describe('#398 the token-block rules fail on a broken stylesheet (in-memory cases)', () => {
  type Lines = string[];
  const BASE_LIGHT: Lines = [
    'color-scheme: light;',
    '--color-bg: #ffffff;',
    '--color-ink: #111111;',
    '--color-link: var(--color-ink);',
    '--focus-ring: 3px solid var(--color-link);',
    '--elevation-1: none;',
  ];
  const BASE_DARK: Lines = [
    'color-scheme: dark;',
    '--color-bg: #000000;',
    '--color-ink: #eeeeee;',
    '--color-link: var(--color-ink);',
    '--focus-ring: 3px solid var(--color-link);',
  ];
  const css = (parts: { light?: Lines; dark?: Lines; media?: Lines; extra?: string } = {}): string => {
    const body = (lines: Lines) => lines.map((line) => `  ${line}\n`).join('');
    const dark = parts.dark ?? BASE_DARK;
    return (
      `:root {\n${body(parts.light ?? BASE_LIGHT)}}\n` +
      `:root[data-theme='dark'],\n[data-theme='dark'] {\n${body(dark)}}\n` +
      `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n${body(parts.media ?? dark)}  }\n}\n` +
      (parts.extra ?? '')
    );
  };
  const REQUIRED = ['--elevation-1'];
  const without = (lines: Lines, name: string): Lines => lines.filter((line) => !line.startsWith(`${name}:`));

  it('accepts the baseline, so each failure below is the one change', () => {
    expect(themeProblems(css(), REQUIRED)).toEqual([]);
  });

  it('accepts a selector written with other spacing and double quotes', () => {
    const spaced = css().replace(":root[data-theme='dark'],\n[data-theme='dark']", `:root[data-theme="dark"]  ,   [data-theme="dark"]`);
    expect(themeProblems(spaced, REQUIRED)).toEqual([]);
  });

  it('ignores a comment between the blocks, even one with braces in it', () => {
    expect(themeProblems(`/* { nothing } */\n${css()}`, REQUIRED)).toEqual([]);
  });

  it('reports a colour token the dark block does not give a value', () => {
    expect(themeProblems(css({ dark: without(BASE_DARK, '--color-bg') }), REQUIRED)).toEqual([
      'dark lacks the colour token --color-bg',
      'media lacks the colour token --color-bg',
    ]);
  });

  it('reports a dark colour token the light block does not have', () => {
    const problems = themeProblems(css({ dark: [...BASE_DARK, '--color-extra: #123456;'] }), REQUIRED);
    expect(problems).toContain('dark has --color-extra, which light lacks');
  });

  it('reports the media copy drifting from the dark block: a changed value, a missing line, an added line, a new order', () => {
    const drift = (media: Lines) => themeProblems(css({ media }), REQUIRED);
    expect(drift(BASE_DARK.map((line) => line.replace('#000000', '#010101')))).toEqual([
      'media differs from dark: media lacks --color-bg: #000000; media adds --color-bg: #010101',
    ]);
    expect(drift([...BASE_DARK.slice(0, 2), ...BASE_DARK.slice(3)])).toEqual([
      'media lacks the colour token --color-ink',
      'media differs from dark: media lacks --color-ink: #eeeeee',
    ]);
    expect(drift([...BASE_DARK, '--focus-offset: 2px;'])).toEqual([
      'media differs from dark: media adds --focus-offset: 2px',
    ]);
    const reordered = [BASE_DARK[0], BASE_DARK[2], BASE_DARK[1], ...BASE_DARK.slice(3)];
    expect(drift(reordered)).toEqual(['media differs from dark: order or a repeated line']);
    expect(drift([...BASE_DARK, '--color-bg: #000000;'])).toEqual(['media differs from dark: order or a repeated line']);
  });

  it('reports an alias the dark block does not declare again, and one it declares as a literal', () => {
    const noFocusRing = without(BASE_DARK, '--focus-ring');
    expect(themeProblems(css({ dark: noFocusRing }), REQUIRED)).toEqual(['alias --focus-ring is not declared again in dark']);
    const literal = BASE_DARK.map((line) => (line.startsWith('--focus-ring') ? '--focus-ring: 3px solid #ffffff;' : line));
    expect(themeProblems(css({ dark: literal }), REQUIRED)).toEqual(['alias --focus-ring is a literal in dark']);
    const linkLiteral = BASE_DARK.map((line) => (line.startsWith('--color-link') ? '--color-link: #eeeeee;' : line));
    expect(themeProblems(css({ dark: linkLiteral }), REQUIRED)).toEqual(['alias --color-link is a literal in dark']);
  });

  it('reports a wrong or missing color-scheme in each of the three blocks', () => {
    expect(themeProblems(css({ light: ['color-scheme: dark;', ...BASE_LIGHT.slice(1)] }), REQUIRED)).toEqual([
      'color-scheme of light is dark',
    ]);
    const noScheme = BASE_DARK.slice(1);
    expect(themeProblems(css({ dark: noScheme }), REQUIRED)).toEqual([
      'color-scheme of dark is null',
      'color-scheme of media is null',
    ]);
    const lightAgain = ['color-scheme: light;', ...BASE_DARK.slice(1)];
    expect(themeProblems(css({ media: lightAgain }), REQUIRED)).toEqual(['color-scheme of media is light']);
  });

  it('reports a missing block and a duplicate block', () => {
    expect(themeProblems(css().replace('@media (prefers-color-scheme: dark)', '@media print'), REQUIRED)).toEqual([
      'missing block: media',
    ]);
    expect(themeProblems(css({ extra: ":root[data-theme='dark'], [data-theme='dark'] {\n  --color-bg: #fff;\n}\n" }), REQUIRED)).toEqual([
      'duplicate block: dark',
    ]);
    expect(themeProblems('body { margin: 0; }\n', REQUIRED)).toEqual(['missing block: light', 'missing block: dark', 'missing block: media']);
  });

  it('reports a required new token the light block does not define', () => {
    expect(themeProblems(css(), ['--elevation-2'])).toEqual(['new token missing in light: --elevation-2']);
  });

  it('lets a raw colour live inside the three blocks of globals and nowhere else', () => {
    const inside = [{ file: GLOBALS, text: css() }];
    expect(styleViolations(inside)).toEqual([]);
    const outside = [{ file: GLOBALS, text: css({ extra: '.x {\n  color: #abcdef;\n}\n' }) }];
    expect(styleViolations(outside).map((h) => h.rule)).toEqual(['raw colour']);
    const fourth = [{ file: GLOBALS, text: css({ extra: ":root[data-theme='other'] {\n  --color-x: #abcdef;\n}\n" }) }];
    expect(styleViolations(fourth).map((h) => h.rule)).toEqual(['raw colour']);
    const aComment = [{ file: GLOBALS, text: `/* the old value was #abcdef */\n${css()}` }];
    expect(styleViolations(aComment).map((h) => h.rule)).toEqual(['raw colour']);
  });
});

// #398 contrast: the floor-bearing pairs of system.md section Palette, typed out here so the document is not its
// own oracle, computed from the values in globals.css with WCAG 2.1 relative luminance. Floors, not the
// documented ratios: a value edit that keeps the floor passes. Left out: the decorative `border` on `canvas`,
// the disabled pair (exempt while disabled) and `--color-scrim` (it has no pair).
const TEXT = 4.5;
const EDGE = 3;
const PAIRS: [string, string, number][] = [
  ['--color-text', '--color-bg', TEXT],
  ['--color-text', '--color-canvas', TEXT],
  ['--color-text', '--color-warning-bg', TEXT],
  ['--color-muted', '--color-bg', TEXT],
  ['--color-muted', '--color-canvas', TEXT],
  ['--color-muted', '--color-chip-bg', TEXT],
  ['--color-chip-text', '--color-chip-bg', TEXT],
  ['--color-price', '--color-bg', TEXT],
  ['--color-link', '--color-bg', TEXT],
  ['--color-link', '--color-canvas', TEXT],
  ['--color-link', '--color-chip-bg', TEXT],
  ['--color-on-frame', '--color-frame', TEXT],
  ['--color-on-frame-muted', '--color-frame', TEXT],
  ['--color-on-frame', '--color-on-frame-line', TEXT],
  ['--color-on-accent', '--color-accent', TEXT],
  ['--color-on-accent', '--color-accent-hover', TEXT],
  ['--color-on-accent', '--color-accent-active', TEXT],
  ['--color-on-ink', '--color-ink', TEXT],
  ['--color-on-ink-muted', '--color-ink', TEXT],
  ['--color-success', '--color-success-bg', TEXT],
  ['--color-warning', '--color-warning-bg', TEXT],
  ['--color-danger', '--color-danger-bg', TEXT],
  ['--color-info', '--color-info-bg', TEXT],
  ['--color-border-strong', '--color-bg', EDGE],
  ['--color-border-strong', '--color-canvas', EDGE],
  ['--color-border-strong', '--color-frame', EDGE],
  ['--color-focus', '--color-bg', EDGE],
  ['--color-focus', '--color-canvas', EDGE],
  ['--color-accent', '--color-frame', EDGE],
  ['--color-accent-edge', '--color-bg', EDGE],
];

function rgbOf(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour a token holds in a set, following `var(--token)` aliases (an alias reads the set it is declared in). */
function colourOf(set: TokenSet, name: string, depth = 0): string {
  const value = set.declarations.find(([declared]) => declared === name)?.[1];
  if (value === undefined) throw new Error(`token ${name} is not declared in the set`);
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (alias === null) return value;
  if (depth > 5) throw new Error(`alias chain of ${name} is too deep`);
  return colourOf(set, alias[1], depth + 1);
}

function contrastProblems(set: TokenSet, pairs: [string, string, number][]): string[] {
  return pairs.flatMap(([fg, bg, floor]) => {
    const ratio = contrast(colourOf(set, fg), colourOf(set, bg));
    return ratio >= floor ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} is under ${floor}`];
  });
}

describe('#398 contrast floors, both schemes', () => {
  const globals = srcCss().find((f) => f.file === GLOBALS)?.text ?? '';
  const sets = tokenBlocks(globals);

  it('computes the ratio the way WCAG 2.1 does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#123456', '#123456')).toBe(1);
  });

  it('follows an alias to the colour it reads, in the set that declares it', () => {
    const set: TokenSet = {
      scheme: null,
      declarations: [
        ['--color-ink', '#e9ecf1'],
        ['--color-link', 'var(--color-ink)'],
      ],
    };
    expect(colourOf(set, '--color-link')).toBe('#e9ecf1');
    expect(() => colourOf(set, '--color-nothing')).toThrow(/not declared/);
  });

  it('types out at least the thirty pairs and each names two tokens the light block defines', () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(30);
    const light = readSet(sets.light[0]);
    for (const [fg, bg] of PAIRS) {
      expect(() => colourOf(light, fg), fg).not.toThrow();
      expect(() => colourOf(light, bg), bg).not.toThrow();
    }
  });

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['dark, the no-script media copy', 'media'],
  ] as const)('holds 4.5:1 for text and 3:1 for edges and rings in %s', (_label, name) => {
    expect(sets[name]).toHaveLength(1);
    expect(contrastProblems(readSet(sets[name][0]), PAIRS)).toEqual([]);
  });

  it('fails a set whose value is under the floor, naming the pair and the ratio', () => {
    const set: TokenSet = {
      scheme: null,
      declarations: [
        ['--color-muted', '#777777'],
        ['--color-bg', '#ffffff'],
        ['--color-border-strong', '#cccccc'],
      ],
    };
    expect(
      contrastProblems(set, [
        ['--color-muted', '--color-bg', TEXT],
        ['--color-border-strong', '--color-bg', EDGE],
      ]),
    ).toEqual(['--color-muted on --color-bg: 4.48 is under 4.5', '--color-border-strong on --color-bg: 1.61 is under 3']);
  });

  it('passes a set that edits a value but keeps the floor', () => {
    const set: TokenSet = {
      scheme: null,
      declarations: [
        ['--color-muted', '#6f6f6f'],
        ['--color-bg', '#ffffff'],
      ],
    };
    expect(contrastProblems(set, [['--color-muted', '--color-bg', TEXT]])).toEqual([]);
  });
});
