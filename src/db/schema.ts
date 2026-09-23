import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// Capacity note: 20 symbols × 1,440 minute polls/day × 90 raw days
// yields approximately 2,592,000 observations before hourly thinning.
export const observations = pgTable(
  "observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    venue: varchar("venue", { length: 16 }).notNull().default("xstocks"),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    mint: varchar("mint", { length: 64 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    onchainPrice: doublePrecision("onchain_price"),
    referencePrice: doublePrecision("reference_price"),
    premiumPct: doublePrecision("premium_pct"),
    referenceSource: varchar("reference_source", { length: 16 }),
    referencePublishedAt: timestamp("reference_published_at", {
      withTimezone: true,
      mode: "date",
    }),
    confidenceInterval: doublePrecision("confidence_interval"),
    marketPeriod: varchar("market_period", { length: 16 }),
    marketOpen: boolean("market_open").notNull().default(false),
    halted: boolean("halted").notNull().default(false),
    jupiterBlockId: doublePrecision("jupiter_block_id"),
    routeLabel: text("route_label"),
    poolTvlUsd: doublePrecision("pool_tvl_usd"),
    poolVolume24hUsd: doublePrecision("pool_volume_24h_usd"),
    depth1PctUsd: doublePrecision("depth_1pct_usd"),
    priceImpactAt1kPct: doublePrecision("price_impact_at_1k_pct"),
    depthProbed: boolean("depth_probed").notNull().default(false),
    degraded: boolean("degraded").notNull().default(false),
    degradedReason: text("degraded_reason"),
  },
  (table) => [
    index("observations_observed_at_idx").on(table.observedAt),
    index("observations_symbol_observed_at_idx").on(table.symbol, table.observedAt),
    index("observations_venue_symbol_observed_at_idx").on(
      table.venue,
      table.symbol,
      table.observedAt,
    ),
  ],
);

export const dailyStats = pgTable(
  "daily_stats",
  {
    date: date("date", { mode: "string" }).notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    observationsCount: integer("observations_count").notNull(),
    premiumMean: doublePrecision("premium_mean"),
    premiumMedian: doublePrecision("premium_median"),
    premiumP95: doublePrecision("premium_p95"),
    premiumMin: doublePrecision("premium_min"),
    premiumMax: doublePrecision("premium_max"),
    premiumStddev: doublePrecision("premium_stddev"),
    timeOutsideBandPct: doublePrecision("time_outside_band_pct"),
    depth1PctMedian: doublePrecision("depth_1pct_median"),
    depth1PctMin: doublePrecision("depth_1pct_min"),
    haltedMinutes: doublePrecision("halted_minutes").notNull().default(0),
    degradedMinutes: doublePrecision("degraded_minutes").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.date, table.symbol], name: "daily_stats_date_symbol_pk" }),
    uniqueIndex("daily_stats_date_symbol_idx").on(table.date, table.symbol),
  ],
);

export type NewObservation = typeof observations.$inferInsert;
