import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',  
  dialect: 'postgresql',
  dbCredentials: {
    // DIRECT_URL = session pooler (5432). drizzle-kit introspection hangs
    // on the transaction pooler (6543) that DATABASE_URL uses at runtime.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
}); 