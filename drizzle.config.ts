import { defineConfig } from "drizzle-kit";

// No migrations are generated this phase (ticket 02, decision 2) — a schema
// change means `bun run db:reset`. This config exists so `drizzle-kit generate`
// still works when that policy ends, and it points at PGlite so nothing here
// can quietly reach for a Supabase URL that no longer exists.
export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: process.env.MINDDYTE_DATA_DIR ?? './.data/minddyte',
  },
});
