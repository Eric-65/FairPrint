import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/bootstrap";
import { dailyStats, observations, type NewObservation } from "@/db/schema";
import {
  getTickerSnapshots,
  withResolvedMints,
  type TickerSnapshotResult,
} from "./market-data";
import { measureLiquidity, type LiquidityMeasurement } from "./liquidity";
import { getCachedPreStocksAssets, type PreStocksAsset } from "./prestocks";
import { getTesseraSnapshots, type TesseraSnapshot } from "./tessera";
import { TRACKED_ASSETS, type TrackedAsset } from "./tracked-assets";

export const ARCHIVE_NOT_CONFIGURED = "Archive is not configured";

export type ObservationVenue = "xstocks" | "prestocks" | "tessera";

// Every run records prices for all symbols but probes route depth for only the
// stalest few (across both venues), keeping Jupiter quote traffic inside the
// free-tier budget. Depth readings stay valid on the watchlist for
// DEPTH_STALE_MINUTES.
const DEPTH_SYMBOLS_PER_RUN = Math.max(1, Number(process.env.DEPTH_SYMBOLS_PER_RUN) || 4);
const DEPTH_STALE_MINUTES = 30;

export interface ArchiveRead<T> {
  data: T;
  degradedReason: string | null;
}

interface ObservationRunSummary {
  observedAt: string;
  attempted: number;
  inserted: number;
  degraded: number;
  widestPremium: {
    symbol: string;
    premiumPct: number;
  } | null;
  depthMeasured: string[];
  degradedReasons: Record<string, number>;
  degradedReason: string | null;
}

interface DepthTarget {
  venue: ObservationVenue;
  symbol: string;
  mint: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Drizzle wraps driver errors as "Failed query: <sql> params: <values>", which
// is useless to a reader; surface the driver's own message instead.
export function describeArchiveError(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  const detail = cause instanceof Error ? cause.message : null;
  return detail ? `Archive query failed: ${detail}` : "Archive query failed";
}

function incrementReason(reasons: Record<string, number>, value: string | null) {
  if (!value) return;
  for (const reason of value.split("; ").map((part) => part.trim()).filter(Boolean)) {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
}

function depthKey(venue: ObservationVenue, symbol: string) {
  return `${venue}:${symbol}`;
}

function liquidityFields(
  liquidityResult: PromiseSettledResult<LiquidityMeasurement> | null,
  context: { venue: ObservationVenue; symbol: string; mint: string },
  degradedReasons: string[],
) {
  if (liquidityResult?.status === "rejected") {
    const reason = errorMessage(liquidityResult.reason, "Liquidity measurement failed");
    console.error("[FairPrint archive] Liquidity measurement failed", {
      ...context,
      error: liquidityResult.reason,
    });
    degradedReasons.push(`Liquidity: ${reason}`);
  }

  const liquidity = liquidityResult?.status === "fulfilled" ? liquidityResult.value : null;
  if (liquidity?.degradedReasons.length) degradedReasons.push(...liquidity.degradedReasons);

  return {
    // A rate-limited probe never reached Jupiter's answer, so it should stay
    // at the front of the rotation rather than count as an attempt.
    depthProbed: liquidityResult !== null && !liquidity?.rateLimited,
    routeLabel: liquidity?.routeLabel ?? null,
    poolTvlUsd: liquidity?.poolTvlUsd ?? null,
    poolVolume24hUsd: liquidity?.poolVolume24hUsd ?? null,
    depth1PctUsd: liquidity?.depth1PctUsd ?? null,
    priceImpactAt1kPct: liquidity?.priceImpactAt1kPct ?? null,
  };
}

function collectAssetObservation(
  asset: TrackedAsset & { mint: string },
  observedAt: Date,
  snapshotResult: TickerSnapshotResult,
  liquidityResult: PromiseSettledResult<LiquidityMeasurement> | null,
): NewObservation {
  const degradedReasons: string[] = [];

  if (snapshotResult.error) {
    degradedReasons.push(`Fair value: ${snapshotResult.error}`);
  }

  const snapshot = snapshotResult.snapshot;
  if (snapshot?.degraded.reason) degradedReasons.push(snapshot.degraded.reason);
  const liquidity = liquidityFields(
    liquidityResult,
    { venue: "xstocks", symbol: asset.symbol, mint: asset.mint },
    degradedReasons,
  );

  return {
    venue: "xstocks",
    symbol: asset.symbol,
    mint: snapshot?.mint ?? asset.mint,
    observedAt,
    onchainPrice: snapshot?.onchainPrice ?? null,
    referencePrice: snapshot?.referencePrice ?? null,
    premiumPct: snapshot?.premiumPct ?? null,
    referenceSource:
      snapshot?.source.reference === "xStocks Public API"
        ? "issuer"
        : snapshot?.source.reference === "Pyth Hermes"
          ? "pyth"
          : snapshot?.source.reference === "Jupiter stockData"
            ? "jupiter"
            : null,
    referencePublishedAt:
      snapshot?.freshness.referenceUpdatedAt || snapshot?.freshness.pythPublishedAt
        ? new Date(
            snapshot.freshness.referenceUpdatedAt ?? snapshot.freshness.pythPublishedAt!,
          )
        : null,
    confidenceInterval: snapshot?.referenceConfidence.absolute ?? null,
    marketPeriod: snapshot?.market.period ?? null,
    marketOpen: snapshot?.market.open ?? false,
    halted: snapshot?.market.halted ?? false,
    jupiterBlockId: snapshot?.source.jupiterBlockId ?? null,
    ...liquidity,
    degraded: degradedReasons.length > 0,
    degradedReason: degradedReasons.length > 0 ? degradedReasons.join("; ") : null,
  };
}

function collectPreStocksObservation(
  asset: PreStocksAsset,
  observedAt: Date,
  liquidityResult: PromiseSettledResult<LiquidityMeasurement> | null,
): NewObservation {
  const degradedReasons: string[] = [];

  if (asset.degradedReason) degradedReasons.push(asset.degradedReason);
  const liquidity = liquidityFields(
    liquidityResult,
    { venue: "prestocks", symbol: asset.symbol, mint: asset.mint },
    degradedReasons,
  );

  return {
    venue: "prestocks",
    symbol: asset.symbol,
    mint: asset.mint,
    observedAt,
    onchainPrice: asset.tokenPrice,
    referencePrice: asset.markPrice,
    premiumPct: asset.premiumPct,
    referenceSource: "prestocks",
    referencePublishedAt: null,
    confidenceInterval: null,
    marketPeriod: null,
    marketOpen: false,
    halted: false,
    jupiterBlockId: null,
    ...liquidity,
    degraded: degradedReasons.length > 0,
    degradedReason: degradedReasons.length > 0 ? degradedReasons.join("; ") : null,
  };
}

function collectTesseraObservation(
  snapshot: TesseraSnapshot,
  observedAt: Date,
  liquidityResult: PromiseSettledResult<LiquidityMeasurement> | null,
): NewObservation {
  const degradedReasons: string[] = [];
  if (snapshot.degradedReason) degradedReasons.push(snapshot.degradedReason);
  const liquidity = liquidityFields(
    liquidityResult,
    { venue: "tessera", symbol: snapshot.token.symbol, mint: snapshot.token.mint },
    degradedReasons,
  );

  return {
    venue: "tessera",
    symbol: snapshot.token.symbol,
    mint: snapshot.token.mint,
    observedAt,
    onchainPrice: snapshot.onchainPrice,
    referencePrice: snapshot.token.markPrice,
    premiumPct: snapshot.premiumPct,
    referenceSource: "tessera",
    referencePublishedAt: null,
    confidenceInterval: null,
    marketPeriod: null,
    marketOpen: false,
    halted: false,
    jupiterBlockId: snapshot.jupiterBlockId,
    impliedValuation: snapshot.impliedValuation,
    ...liquidity,
    degraded: degradedReasons.length > 0,
    degradedReason: degradedReasons.length > 0 ? degradedReasons.join("; ") : null,
  };
}

async function pickDepthTargets(
  db: NonNullable<ReturnType<typeof getDb>>,
  xStocksAssets: readonly (TrackedAsset & { mint: string })[],
  preStocksAssets: readonly PreStocksAsset[],
  tesseraSnapshots: readonly TesseraSnapshot[],
): Promise<DepthTarget[]> {
  const targets: DepthTarget[] = [
    ...xStocksAssets.map((asset) => ({ venue: "xstocks" as const, symbol: asset.symbol, mint: asset.mint })),
    ...preStocksAssets.map((asset) => ({ venue: "prestocks" as const, symbol: asset.symbol, mint: asset.mint })),
    ...tesseraSnapshots.map(({ token }) => ({ venue: "tessera" as const, symbol: token.symbol, mint: token.mint })),
  ];
  // Rotate on the last probe attempt, not the last success: a ticker with no
  // Jupiter route never succeeds, and ordering by success would re-pick it
  // every run and starve every other ticker of fresh depth.
  const result = await db.execute(sql<{ venue: ObservationVenue; symbol: string; lastDepthAt: Date | null }>`
    select venue, symbol, max(observed_at) as "lastDepthAt"
    from ${observations}
    where (depth_probed or depth_1pct_usd is not null)
      and observed_at >= now() - interval '1 day'
    group by venue, symbol
  `);
  const lastDepthAt = new Map(
    (result.rows as unknown as { venue: ObservationVenue; symbol: string; lastDepthAt: Date | null }[]).map(
      (row) => [depthKey(row.venue, row.symbol), row.lastDepthAt ? new Date(row.lastDepthAt).getTime() : 0],
    ),
  );

  return targets
    .sort((left, right) =>
      (lastDepthAt.get(depthKey(left.venue, left.symbol)) ?? 0) -
      (lastDepthAt.get(depthKey(right.venue, right.symbol)) ?? 0))
    .slice(0, DEPTH_SYMBOLS_PER_RUN);
}

async function measureScheduledLiquidity(targets: readonly DepthTarget[]) {
  const results = new Map<string, PromiseSettledResult<LiquidityMeasurement>>();
  // Sequential on purpose: probes for one mint are already serial, and running
  // mints in parallel is what tripped the Jupiter sliding-window limit.
  for (const target of targets) {
    const [result] = await Promise.allSettled([measureLiquidity(target.mint)]);
    results.set(depthKey(target.venue, target.symbol), result);
    if (result.status === "fulfilled" && result.value.rateLimited) {
      console.warn("[FairPrint archive] Jupiter rate limit reached; deferring remaining depth probes", {
        measured: [...results.keys()],
      });
      break;
    }
  }
  return results;
}

export async function recordObservations(): Promise<ObservationRunSummary> {
  const observedAt = new Date();
  const db = getDb();
  if (!db) {
    return {
      observedAt: observedAt.toISOString(),
      attempted: 0,
      inserted: 0,
      degraded: 0,
      widestPremium: null,
      depthMeasured: [],
      degradedReasons: { [ARCHIVE_NOT_CONFIGURED]: 1 },
      degradedReason: ARCHIVE_NOT_CONFIGURED,
    };
  }

  await ensureSchema(db);
  // A ticker whose mint can't be resolved can't be priced, probed, or stored.
  const xStocksAssets = (await withResolvedMints(TRACKED_ASSETS)).filter(
    (asset): asset is TrackedAsset & { mint: string } => asset.mint !== null,
  );
  const unresolved = TRACKED_ASSETS.length - xStocksAssets.length;
  const preStocksPromise = getCachedPreStocksAssets().then(
    (assets) => ({ assets, error: null as string | null }),
    (error: unknown) => {
      console.error("[FairPrint archive] PreStocks fetch failed", { error });
      return { assets: [] as PreStocksAsset[], error: errorMessage(error, "PreStocks fetch failed") };
    },
  );
  const tesseraPromise = getTesseraSnapshots().then(
    (snapshots) => ({ snapshots, error: null as string | null }),
    (error: unknown) => {
      console.error("[FairPrint archive] Tessera fetch failed", { error });
      return { snapshots: [] as TesseraSnapshot[], error: errorMessage(error, "Tessera fetch failed") };
    },
  );
  const [snapshots, preStocks, tessera, liquidityByKey] = await Promise.all([
    getTickerSnapshots(xStocksAssets),
    preStocksPromise,
    tesseraPromise,
    Promise.all([preStocksPromise, tesseraPromise])
      .then(([{ assets }, { snapshots: tesseraSnapshots }]) =>
        pickDepthTargets(db, xStocksAssets, assets, tesseraSnapshots))
      .then(measureScheduledLiquidity),
  ]);
  const snapshotsBySymbol = new Map(snapshots.map((result) => [result.symbol, result]));
  const rows = [
    ...xStocksAssets.map((asset) =>
      collectAssetObservation(
        asset,
        observedAt,
        snapshotsBySymbol.get(asset.symbol) ?? {
          symbol: asset.symbol,
          snapshot: null,
          error: "Ticker was omitted from the batch result",
        },
        liquidityByKey.get(depthKey("xstocks", asset.symbol)) ?? null,
      ),
    ),
    ...preStocks.assets.map((asset) =>
      collectPreStocksObservation(
        asset,
        observedAt,
        liquidityByKey.get(depthKey("prestocks", asset.symbol)) ?? null,
      ),
    ),
    ...tessera.snapshots.map((snapshot) =>
      collectTesseraObservation(
        snapshot,
        observedAt,
        liquidityByKey.get(depthKey("tessera", snapshot.token.symbol)) ?? null,
      ),
    ),
  ];

  const inserted = await db
    .insert(observations)
    .values(rows)
    .returning({
      symbol: observations.symbol,
      premiumPct: observations.premiumPct,
      degraded: observations.degraded,
      degradedReason: observations.degradedReason,
    });
  const degradedReasons: Record<string, number> = {};
  let widestPremium: ObservationRunSummary["widestPremium"] = null;

  for (const row of inserted) {
    if (row.degraded) incrementReason(degradedReasons, row.degradedReason);
    if (
      row.premiumPct !== null &&
      (widestPremium === null || Math.abs(row.premiumPct) > Math.abs(widestPremium.premiumPct))
    ) {
      widestPremium = { symbol: row.symbol, premiumPct: row.premiumPct };
    }
  }
  if (preStocks.error) {
    incrementReason(degradedReasons, `PreStocks: ${preStocks.error}`);
  }
  if (tessera.error) {
    incrementReason(degradedReasons, `Tessera: ${tessera.error}`);
  }
  if (unresolved > 0) {
    degradedReasons["xStocks mint lookup failed"] = unresolved;
  }

  return {
    observedAt: observedAt.toISOString(),
    attempted: TRACKED_ASSETS.length + preStocks.assets.length + tessera.snapshots.length,
    inserted: inserted.length,
    degraded: inserted.filter((row) => row.degraded).length,
    widestPremium,
    depthMeasured: rows
      .filter((row) => row.depth1PctUsd !== null && row.depth1PctUsd !== undefined)
      .map((row) => row.symbol),
    degradedReasons,
    degradedReason: null,
  };
}

export interface ArchivedLiquidity {
  symbol: string;
  depth1PctUsd: number | null;
  priceImpactAt1kPct: number | null;
  routeLabel: string | null;
  poolTvlUsd: number | null;
  poolVolume24hUsd: number | null;
  observedAt: Date;
  degraded: boolean;
  degradedReason: string | null;
}

export interface WidestGap {
  symbol: string;
  premiumPct: number;
  observedAt: Date;
}

function symbolListSql(symbols: readonly string[]) {
  return sql.join(symbols.map((symbol) => sql`${symbol}`), sql`, `);
}

export async function getLatestArchivedLiquidity(
  venue: ObservationVenue = "xstocks",
  symbols: readonly string[] = TRACKED_ASSETS.map((asset) => asset.symbol),
): Promise<ArchiveRead<ArchivedLiquidity[]>> {
  const db = getDb();
  if (!db) {
    return { data: [], degradedReason: ARCHIVE_NOT_CONFIGURED };
  }
  if (symbols.length === 0) {
    return { data: [], degradedReason: null };
  }

  await ensureSchema(db);
  // Depth is probed on a rotation, so the newest row for a symbol usually has
  // no depth. Prefer the most recent measured reading inside the freshness
  // window and fall back to the newest row so its degraded reason surfaces.
  const columns = sql`
      symbol,
      depth_1pct_usd as "depth1PctUsd",
      price_impact_at_1k_pct as "priceImpactAt1kPct",
      route_label as "routeLabel",
      pool_tvl_usd as "poolTvlUsd",
      pool_volume_24h_usd as "poolVolume24hUsd",
      observed_at as "observedAt",
      degraded,
      degraded_reason as "degradedReason"`;
  const [measured, latest] = await Promise.all([
    db.execute(sql<ArchivedLiquidity>`
      select distinct on (symbol) ${columns}
      from ${observations}
      where venue = ${venue}
        and symbol in (${symbolListSql(symbols)})
        and depth_1pct_usd is not null
        and observed_at >= now() - make_interval(mins => ${DEPTH_STALE_MINUTES})
      order by symbol, observed_at desc
    `),
    db.execute(sql<ArchivedLiquidity>`
      select distinct on (symbol) ${columns}
      from ${observations}
      where venue = ${venue}
        and symbol in (${symbolListSql(symbols)})
      order by symbol, observed_at desc
    `),
  ]);
  const bySymbol = new Map(
    (latest.rows as unknown as ArchivedLiquidity[]).map((row) => [row.symbol, row]),
  );
  for (const row of measured.rows as unknown as ArchivedLiquidity[]) {
    bySymbol.set(row.symbol, row);
  }

  return {
    data: [...bySymbol.values()],
    degradedReason: null,
  };
}

export interface ArchivedPrice {
  onchainPrice: number;
  referencePrice: number | null;
  premiumPct: number | null;
  observedAt: Date;
}

// The minute poller already records every xStock's live price, so a request
// that loses its own Jupiter price call (rate limit, timeout) can fall back to
// the newest reading instead of reporting nothing.
export async function getLatestArchivedPrice(
  symbol: string,
  maxAgeMinutes = 5,
  venue: ObservationVenue = "xstocks",
): Promise<ArchivedPrice | null> {
  const db = getDb();
  if (!db) return null;

  await ensureSchema(db);
  const result = await db.execute(sql`
    select
      onchain_price as "onchainPrice",
      reference_price as "referencePrice",
      premium_pct as "premiumPct",
      observed_at as "observedAt"
    from ${observations}
    where venue = ${venue}
      and symbol = ${symbol}
      and onchain_price is not null
      and observed_at >= now() - make_interval(mins => ${maxAgeMinutes})
    order by observed_at desc
    limit 1
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    onchainPrice: Number(row.onchainPrice),
    referencePrice: row.referencePrice === null ? null : Number(row.referencePrice),
    premiumPct: row.premiumPct === null ? null : Number(row.premiumPct),
    observedAt: new Date(row.observedAt as string | Date),
  };
}

export const HISTORY_RANGES = {
  "24h": { spanMs: 24 * 3_600_000, bucket: "15 minutes", bucketMs: 15 * 60_000 },
  "7d": { spanMs: 7 * 86_400_000, bucket: "1 hour", bucketMs: 60 * 60_000 },
  "30d": { spanMs: 30 * 86_400_000, bucket: "6 hours", bucketMs: 6 * 60 * 60_000 },
} as const;

export type HistoryRange = keyof typeof HISTORY_RANGES;

export interface PremiumHistoryPoint {
  bucketStart: string;
  premiumAvg: number;
  premiumMin: number;
  premiumMax: number;
  tokenPriceAvg: number | null;
  markPriceAvg: number | null;
  readings: number;
}

export interface PremiumHistorySummary {
  firstObservedAt: string;
  lastObservedAt: string;
  readings: number;
  premiumMin: number;
  premiumMax: number;
  premiumMean: number;
  // Share of readings more than 2% from the mark, the gate's overpay line.
  pctBeyondTwoPct: number;
  depthMedianUsd: number | null;
}

export interface PremiumHistory {
  range: HistoryRange;
  windowStart: string;
  windowEnd: string;
  bucketMs: number;
  points: PremiumHistoryPoint[];
  summary: PremiumHistorySummary | null;
}

export async function getPremiumHistory(
  venue: ObservationVenue,
  symbol: string,
  range: HistoryRange,
): Promise<ArchiveRead<PremiumHistory>> {
  const { spanMs, bucket, bucketMs } = HISTORY_RANGES[range];
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - spanMs);
  const frame = { range, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), bucketMs };
  const empty = { ...frame, points: [], summary: null };
  const db = getDb();
  if (!db) {
    return { data: empty, degradedReason: ARCHIVE_NOT_CONFIGURED };
  }

  await ensureSchema(db);
  const window = sql`
    venue = ${venue}
      and symbol = ${symbol}
      and premium_pct is not null
      and observed_at >= ${windowStart}`;
  const [buckets, summary] = await Promise.all([
    db.execute(sql`
      select
        date_bin(${bucket}::interval, observed_at, timestamptz '2000-01-01 00:00:00+00') as "bucketStart",
        avg(premium_pct) as "premiumAvg",
        min(premium_pct) as "premiumMin",
        max(premium_pct) as "premiumMax",
        avg(onchain_price) as "tokenPriceAvg",
        avg(reference_price) as "markPriceAvg",
        count(*)::integer as readings
      from ${observations}
      where ${window}
      group by 1
      order by 1
    `),
    db.execute(sql`
      select
        min(observed_at) as "firstObservedAt",
        max(observed_at) as "lastObservedAt",
        count(*)::integer as readings,
        min(premium_pct) as "premiumMin",
        max(premium_pct) as "premiumMax",
        avg(premium_pct) as "premiumMean",
        100.0 * count(*) filter (where abs(premium_pct) > 2) / nullif(count(*), 0) as "pctBeyondTwoPct",
        percentile_cont(0.5) within group (order by depth_1pct_usd) as "depthMedianUsd"
      from ${observations}
      where ${window}
    `),
  ]);

  const toIso = (value: unknown) => new Date(value as string | Date).toISOString();
  const toNumber = (value: unknown) => (value === null ? null : Number(value));
  const points = (buckets.rows as Record<string, unknown>[]).map((row) => ({
    bucketStart: toIso(row.bucketStart),
    premiumAvg: Number(row.premiumAvg),
    premiumMin: Number(row.premiumMin),
    premiumMax: Number(row.premiumMax),
    tokenPriceAvg: toNumber(row.tokenPriceAvg),
    markPriceAvg: toNumber(row.markPriceAvg),
    readings: Number(row.readings),
  }));
  const totals = summary.rows[0] as Record<string, unknown> | undefined;

  return {
    data: {
      ...frame,
      points,
      summary: totals && Number(totals.readings) > 0
        ? {
            firstObservedAt: toIso(totals.firstObservedAt),
            lastObservedAt: toIso(totals.lastObservedAt),
            readings: Number(totals.readings),
            premiumMin: Number(totals.premiumMin),
            premiumMax: Number(totals.premiumMax),
            premiumMean: Number(totals.premiumMean),
            pctBeyondTwoPct: Number(totals.pctBeyondTwoPct),
            depthMedianUsd: toNumber(totals.depthMedianUsd),
          }
        : null,
    },
    degradedReason: null,
  };
}

export async function getWidestGap24h(): Promise<ArchiveRead<WidestGap | null>> {
  const db = getDb();
  if (!db) {
    return { data: null, degradedReason: ARCHIVE_NOT_CONFIGURED };
  }

  await ensureSchema(db);
  const result = await db.execute(sql<WidestGap>`
    select symbol, premium_pct as "premiumPct", observed_at as "observedAt"
    from ${observations}
    where observed_at >= now() - interval '24 hours'
      and venue = 'xstocks'
      and symbol in (${symbolListSql(TRACKED_ASSETS.map((asset) => asset.symbol))})
      and premium_pct is not null
    order by abs(premium_pct) desc
    limit 1
  `);

  return {
    data: (result.rows[0] as unknown as WidestGap | undefined) ?? null,
    degradedReason: null,
  };
}

export async function rollupDailyStats(date?: string) {
  const rollupDate = date ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rollupDate)) {
    throw new Error("Rollup date must use YYYY-MM-DD format");
  }

  const db = getDb();
  if (!db) {
    return {
      date: rollupDate,
      symbolsRolledUp: 0,
      degradedReason: ARCHIVE_NOT_CONFIGURED,
    };
  }

  await ensureSchema(db);
  const result = await db.execute(sql`
    insert into ${dailyStats} (
      date,
      symbol,
      observations_count,
      premium_mean,
      premium_median,
      premium_p95,
      premium_min,
      premium_max,
      premium_stddev,
      time_outside_band_pct,
      depth_1pct_median,
      depth_1pct_min,
      halted_minutes,
      degraded_minutes
    )
    select
      ${rollupDate}::date as date,
      symbol,
      count(*)::integer as observations_count,
      avg(premium_pct) as premium_mean,
      percentile_cont(0.5) within group (order by premium_pct) as premium_median,
      percentile_cont(0.95) within group (order by premium_pct) as premium_p95,
      min(premium_pct) as premium_min,
      max(premium_pct) as premium_max,
      stddev_pop(premium_pct) as premium_stddev,
      100.0 * count(*) filter (
        where reference_source = 'pyth'
          and onchain_price is not null
          and reference_price is not null
          and confidence_interval is not null
          and abs(onchain_price - reference_price) > confidence_interval
      ) / nullif(count(*) filter (
        where reference_source = 'pyth'
          and onchain_price is not null
          and reference_price is not null
          and confidence_interval is not null
      ), 0) as time_outside_band_pct,
      percentile_cont(0.5) within group (order by depth_1pct_usd) as depth_1pct_median,
      min(depth_1pct_usd) as depth_1pct_min,
      count(*) filter (where halted)::double precision as halted_minutes,
      count(*) filter (where degraded)::double precision as degraded_minutes
    from ${observations}
    where observed_at >= ${rollupDate}::date
      and observed_at < ${rollupDate}::date + interval '1 day'
    group by symbol
    on conflict (date, symbol) do update set
      observations_count = excluded.observations_count,
      premium_mean = excluded.premium_mean,
      premium_median = excluded.premium_median,
      premium_p95 = excluded.premium_p95,
      premium_min = excluded.premium_min,
      premium_max = excluded.premium_max,
      premium_stddev = excluded.premium_stddev,
      time_outside_band_pct = excluded.time_outside_band_pct,
      depth_1pct_median = excluded.depth_1pct_median,
      depth_1pct_min = excluded.depth_1pct_min,
      halted_minutes = excluded.halted_minutes,
      degraded_minutes = excluded.degraded_minutes
    returning symbol
  `);

  return {
    date: rollupDate,
    symbolsRolledUp: result.rowCount ?? 0,
    degradedReason: null,
  };
}
