import 'server-only';

/**
 * Reads one required environment variable at call time (TD-5: never at
 * module load, so `next build` needs no environment and one image serves any
 * configuration). Throws a generic message that names only the variable,
 * never any value (TD-13).
 */
export function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** The PostgreSQL connection URL. Holds the password; never log it. */
export function getDatabaseUrl(): string {
  return readRequiredEnv('DATABASE_URL');
}

/**
 * Reads one optional environment variable at call time. Returns the trimmed
 * value, or `undefined` when it is unset or blank.
 */
export function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}
