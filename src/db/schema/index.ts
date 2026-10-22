// Drizzle schema, the source of the migrations in src/db/migrations.
// Imports only drizzle-orm, so drizzle-kit can load it with no environment.
// Money is integer cents, never a float (guardrail 4). Optional text is null,
// never an empty string (TD-42).
export * from './catalogue';
export * from './sources';
export * from './clicks';
export * from './auth';
