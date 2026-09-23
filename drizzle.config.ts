import { defineConfig } from "drizzle-kit";

// Migrations are real as of 2026-09-23: `bunx drizzle-kit generate` writes a
// new numbered file into db/migrations, and db/bootstrap.ts applies any that a
// database has not recorded yet. Never edit a migration that has shipped —
// generate a new one.
export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: process.env.MINDDYTE_DATA_DIR ?? './.data/minddyte',
  },
});
