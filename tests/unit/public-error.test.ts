import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PublicFallbackProvider } from '@/components/PublicFallbackContext';
import PublicError from '../../src/app/(public)/error';

// The public error page (S5.4, AC 31): finished strings come from a context the
// server fills, and nothing about the failure is rendered.

const value = { heading: 'Titulo de error', body: 'Cuerpo de error.', home: 'Ir al inicio' };

const render = (withProvider: boolean) =>
  renderToStaticMarkup(
    withProvider
      ? // The provider types children as a prop; the lint rule wants them as an argument.
        // eslint-disable-next-line react/no-children-prop
        createElement(PublicFallbackProvider, { value, children: createElement(PublicError) })
      : createElement(PublicError),
  );

describe('(public)/error.tsx', () => {
  it('renders the heading, the body and a link home from the context', () => {
    const html = render(true);
    expect(html).toMatch(/<h1[^>]*>Titulo de error</);
    expect(html).toContain('Cuerpo de error.');
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Ir al inicio</);
    expect(html).toContain('data-testid="public-error"');
  });

  it('renders nothing when no provider is above it', () => {
    expect(render(false)).toBe('');
  });

  it('never reads the error or its digest', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/app/(public)/error.tsx'), 'utf8');
    // Comments are stripped: the file's own doc names both words.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('export default function PublicError()');
    expect(code).not.toMatch(/\.message|\.digest/);
  });
});

describe('client files and the message file', () => {
  function listFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    });
  }

  it('no client file imports messages/es-ES.json', () => {
    const offenders = listFiles(path.resolve(process.cwd(), 'src'))
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return /^\s*['"]use client['"]/.test(text) && /es-ES\.json/.test(text);
      });
    expect(offenders).toEqual([]);
  });
});
