import "server-only";

import { sql } from "drizzle-orm";
import type { FairPrintDb } from "./index";

// Idempotent DDL mirroring ./schema.ts, so a fresh database becomes usable on
// the first observation run without a manual `drizzle-kit push`. Keep this in
// sync with schema.ts; `drizzle-kit generate` prints the canonical statements.
const BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "daily_stats" (
    "date" date NOT NULL,
    "symbol" varchar(32) NOT NULL,
    "observations_count" integer NOT NULL,
    "premium_mean" double precision,
    "premium_median" double precision,
    "premium_p95" double precision,
    "premium_min" double precision,
    "premium_max" double precision,
    "premium_stddev" double precision,
    "time_outside_band_pct" double precision,
    "depth_1pct_median" double precision,
    "depth_1pct_min" double precision,
    "halted_minutes" double precision DEFAULT 0 NOT NULL,
    "degraded_minutes" double precision DEFAULT 0 NOT NULL,
    CONSTRAINT "daily_stats_date_symbol_pk" PRIMARY KEY("date","symbol")
  )`,
  `CREATE TABLE IF NOT EXISTS "observations" (
    "id" bigserial PRIMARY KEY NOT NULL,
    "venue" varchar(16) DEFAULT 'xstocks' NOT NULL,
    "symbol" varchar(32) NOT NULL,
    "mint" varchar(64) NOT NULL,
    "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
    "onchain_price" double precision,
    "reference_price" double precision,
    "premium_pct" double precision,
    "reference_source" varchar(16),
    "reference_published_at" timestamp with time zone,
    "confidence_interval" double precision,
    "market_period" varchar(16),
    "market_open" boolean DEFAULT false NOT NULL,
    "halted" boolean DEFAULT false NOT NULL,
    "jupiter_block_id" double precision,
    "route_label" text,
    "pool_tvl_usd" double precision,
    "pool_volume_24h_usd" double precision,
    "depth_1pct_usd" double precision,
    "price_impact_at_1k_pct" double precision,
    "depth_probed" boolean DEFAULT false NOT NULL,
    "degraded" boolean DEFAULT false NOT NULL,
    "degraded_reason" text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "daily_stats_date_symbol_idx" ON "daily_stats" USING btree ("date","symbol")`,
  `CREATE INDEX IF NOT EXISTS "observations_observed_at_idx" ON "observations" USING btree ("observed_at")`,
  `CREATE INDEX IF NOT EXISTS "observations_symbol_observed_at_idx" ON "observations" USING btree ("symbol","observed_at")`,
  // Upgrades for databases created before the PreStocks venue existed. Guarded
  // by catalog checks so a warm database never takes an ALTER TABLE lock.
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'observations' AND column_name = 'venue'
    ) THEN
      ALTER TABLE "observations" ADD COLUMN "venue" varchar(16) DEFAULT 'xstocks' NOT NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'observations' AND column_name = 'depth_probed'
    ) THEN
      ALTER TABLE "observations" ADD COLUMN "depth_probed" boolean DEFAULT false NOT NULL;
      -- Rows written before this column existed only record successes.
      UPDATE "observations" SET "depth_probed" = true WHERE "depth_1pct_usd" IS NOT NULL;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'observations'
        AND column_name = 'symbol' AND character_maximum_length < 32
    ) THEN
      ALTER TABLE "observations" ALTER COLUMN "symbol" TYPE varchar(32);
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'daily_stats'
        AND column_name = 'symbol' AND character_maximum_length < 32
    ) THEN
      ALTER TABLE "daily_stats" ALTER COLUMN "symbol" TYPE varchar(32);
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "observations_venue_symbol_observed_at_idx" ON "observations" USING btree ("venue","symbol","observed_at")`,
];

declare global {
  var fairPrintSchemaReady: Promise<void> | undefined;
}

export function ensureSchema(db: FairPrintDb): Promise<void> {
  if (!globalThis.fairPrintSchemaReady) {
    globalThis.fairPrintSchemaReady = (async () => {
      for (const statement of BOOTSTRAP_STATEMENTS) {
        await db.execute(sql.raw(statement));
      }
    })().catch((error: unknown) => {
      // Let the next call retry instead of caching a failed bootstrap.
      globalThis.fairPrintSchemaReady = undefined;
      throw error;
    });
  }
  return globalThis.fairPrintSchemaReady;
}
