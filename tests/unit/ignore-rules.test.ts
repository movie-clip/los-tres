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
