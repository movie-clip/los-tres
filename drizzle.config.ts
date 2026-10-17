import { defineConfig } from 'drizzle-kit';

// `npm run db:generate -- --name <name>` writes SQL from the schema into
// src/db/migrations. It needs no database. Migrations are applied by
// src/db/migrate.ts, never by drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
});
