import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from './schema';
import * as relations from './apiRelations'

const databaseUrl = process.env.DATABASE_URL;

if(!databaseUrl){
    throw new Error("DATABASE_URL is not set");
}

const client = postgres(databaseUrl, {
    prepare: false, // good for transaction pooler connection
});

export const db = drizzle(client, {schema: {...schema, ...relations}});
export * from "./schema";
export * from "./apiRelations";
// index.ts is the file for connect the app to supabase postgres