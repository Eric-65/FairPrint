import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type FairPrintDb = NodePgDatabase<typeof schema>;

declare global {
  var fairPrintPool: Pool | undefined;
  var fairPrintDb: FairPrintDb | undefined;
}

export function getDb(): FairPrintDb | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (globalThis.fairPrintDb) return globalThis.fairPrintDb;

  const pool =
    globalThis.fairPrintPool ??
    new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  const database = drizzle(pool, { schema });

  globalThis.fairPrintPool = pool;
  globalThis.fairPrintDb = database;
  return database;
}
