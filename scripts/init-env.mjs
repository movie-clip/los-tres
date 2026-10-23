// Creates `.env` from `.env.example` once. Never overwrites an existing file.
// Fills each blank secret with random hex and derives DATABASE_URL. Prints no
// secret (guardrail 5).
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

const secret = () => randomBytes(24).toString('hex');

const values = new Map();
const lines = readFileSync(examplePath, 'utf8').split(/\r?\n/);
for (const line of lines) {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (match) values.set(match[1], match[2]);
}

for (const name of ['DB_PASSWORD', 'AUTH_SECRET']) {
  if (!values.get(name)) values.set(name, secret());
}
values.set(
  'DATABASE_URL',
  `postgres://${values.get('DB_USER')}:${values.get('DB_PASSWORD')}@127.0.0.1:${values.get('DB_HOST_PORT')}/${values.get('DB_NAME')}`,
);

if (!values.get('SITE_URL')) values.set('SITE_URL', `http://127.0.0.1:${values.get('APP_PORT')}`);

const out = lines
  .map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    return match ? `${match[1]}=${values.get(match[1])}` : line;
  })
  .join('\n');

try {
  writeFileSync(envPath, out, { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error && error.code === 'EEXIST') {
    console.error('.env already exists; left untouched. Delete it first to regenerate.');
    process.exit(1);
  }
  throw error;
}
console.log('.env created with generated secrets.');
