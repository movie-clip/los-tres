import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// S3.7, AC 31 and C-6: a catalogue file can never enter git or the image. The
// folder's contents are ignored by git and left out of the Docker build context;
// only the placeholder is tracked. Removing a line fails this test.

const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), 'utf8');

const lines = (file: string): string[] =>
  read(file)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

describe('catalogue folder ignore rules (AC 31)', () => {
  it('.gitignore ignores the folder contents and keeps only the placeholder', () => {
    const rules = lines('.gitignore');
    expect(rules).toContain('/catalogue-files/*');
    expect(rules).toContain('!/catalogue-files/.gitkeep');
    // The ignore comes before the exception, or the exception would not apply.
    expect(rules.indexOf('/catalogue-files/*')).toBeLessThan(
      rules.indexOf('!/catalogue-files/.gitkeep'),
    );
  });

  it('.dockerignore leaves the whole folder out of the build context', () => {
    expect(lines('.dockerignore')).toContain('catalogue-files');
  });

  it('compose mounts the folder read-only into app, and the Dockerfile never copies it', () => {
    expect(read('compose.yaml')).toMatch(
      /type:\s*bind\s+source:\s*\.\/catalogue-files\s+target:\s*\/app\/catalogue-files\s+read_only:\s*true/,
    );
    expect(read('Dockerfile')).not.toContain('catalogue-files');
  });

  it('tracks an empty placeholder in the folder, so a clone has the folder before Docker does', () => {
    expect(read('catalogue-files/.gitkeep')).toBe('');
  });
});

// Test-speed plan, S1 (decision D-13): the Dockerfile runs `COPY . .`, so any
// file in the build context that changes invalidates that layer and with it
// `next build` and `cli:build`. Run artifacts under `agentic/` change on every
// lane, and the root docs on most pull requests, yet no build step reads them.
// Neither may invalidate the image build, and a scratch `.ts` in a run folder
// must not be type-checked by `tsc` or by `next build`. Removing a line fails.

describe('agentic folder and root docs stay out of the image build', () => {
  it('.dockerignore leaves the agentic folder out of the build context', () => {
    expect(lines('.dockerignore')).toContain('agentic');
  });

  it('.dockerignore leaves the root docs out of the build context', () => {
    const rules = lines('.dockerignore');
    expect(rules).toContain('AGENTS.md');
    expect(rules).toContain('CLAUDE.md');
    expect(rules).toContain('README.md');
  });

  it('tsconfig.json excludes the agentic folder from type-checking', () => {
    // tsconfig.json is plain JSON here (no comments, no trailing commas); if
    // that changes this parse throws, which is the right signal to update it.
    const config = JSON.parse(read('tsconfig.json')) as { exclude?: string[] };
    expect(config.exclude).toContain('agentic');
  });
});
