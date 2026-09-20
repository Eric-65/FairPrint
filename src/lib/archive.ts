import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { dailyStats, observations, type NewObservation } from "@/db/schema";
import { getTickerSnapshots, type TickerSnapshotResult } from "./market-data";
import { measureLiquidity } from "./liquidity";
import { TRACKED_ASSETS, type TrackedAsset } from "./tracked-assets";

export const ARCHIVE_NOT_CONFIGURED = "Archive is not configured";

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
  degradedReasons: Record<string, number>;
  degradedReason: string | null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function incrementReason(reasons: Record<string, number>, value: string | null) {
  if (!value) return;
  for (const reason of value.split("; ").map((part) => part.trim()).filter(Boolean)) {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
}

async function collectAssetObservation(
  asset: TrackedAsset,
  observedAt: Date,
  snapshotResult: TickerSnapshotResult,
): Promise<NewObservation> {
  const [liquidityResult] = await Promise.allSettled([
    measureLiquidity(asset.mint),
  ]);
  const degradedReasons: string[] = [];

  if (snapshotResult.error) {
    degradedReasons.push(`Fair value: ${snapshotResult.error}`);
  }
  if (liquidityResult.status === "rejected") {
    const reason = errorMessage(liquidityResult.reason, "Liquidity measurement failed");
    console.error("[FairPrint archive] Liquidity measurement failed", {
      symbol: asset.symbol,
      mint: asset.mint,
      error: liquidityResult.reason,
    });
    degradedReasons.push(`Liquidity: ${reason}`);
  }

  const snapshot = snapshotResult.snapshot;
  const liquidity = liquidityResult.status === "fulfilled" ? liquidityResult.value : null;
  if (snapshot?.degraded.reason) degradedReasons.push(snapshot.degraded.reason);
  if (liquidity?.degradedReasons.length) degradedReasons.push(...liquidity.degradedReasons);

  return {
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
    routeLabel: liquidity?.routeLabel ?? null,
    poolTvlUsd: liquidity?.poolTvlUsd ?? null,
    poolVolume24hUsd: liquidity?.poolVolume24hUsd ?? null,
    depth1PctUsd: liquidity?.depth1PctUsd ?? null,
    priceImpactAt1kPct: liquidity?.priceImpactAt1kPct ?? null,
    degraded: degradedReasons.length > 0,
    degradedReason: degradedReasons.length > 0 ? degradedReasons.join("; ") : null,
  };
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
      degradedReasons: { [ARCHIVE_NOT_CONFIGURED]: 1 },
      degradedReason: ARCHIVE_NOT_CONFIGURED,
    };
  }

  const snapshots = await getTickerSnapshots(TRACKED_ASSETS);
  const snapshotsBySymbol = new Map(snapshots.map((result) => [result.symbol, result]));
  const rows = await Promise.all(
    TRACKED_ASSETS.map((asset) =>
      collectAssetObservation(
        asset,
        observedAt,
        snapshotsBySymbol.get(asset.symbol) ?? {
          symbol: asset.symbol,
          snapshot: null,
          error: "Ticker was omitted from the batch result",
        },
      ),
    ),
  );

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

  return {
    observedAt: observedAt.toISOString(),
    attempted: TRACKED_ASSETS.length,
    inserted: inserted.length,
    degraded: inserted.filter((row) => row.degraded).length,
    widestPremium,
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

function trackedSymbolSql() {
  return sql.join(TRACKED_ASSETS.map((asset) => sql`${asset.symbol}`), sql`, `);
}

export async function getLatestArchivedLiquidity(): Promise<
  ArchiveRead<ArchivedLiquidity[]>
> {
  const db = getDb();
  if (!db) {
    return { data: [], degradedReason: ARCHIVE_NOT_CONFIGURED };
  }

  const result = await db.execute(sql<ArchivedLiquidity>`
    select distinct on (symbol)
      symbol,
      depth_1pct_usd as "depth1PctUsd",
      price_impact_at_1k_pct as "priceImpactAt1kPct",
      route_label as "routeLabel",
      pool_tvl_usd as "poolTvlUsd",
      pool_volume_24h_usd as "poolVolume24hUsd",
      observed_at as "observedAt",
      degraded,
      degraded_reason as "degradedReason"
    from ${observations}
    where symbol in (${trackedSymbolSql()})
    order by symbol, observed_at desc
  `);

  return {
    data: result.rows as unknown as ArchivedLiquidity[],
    degradedReason: null,
  };
}

export async function getWidestGap24h(): Promise<ArchiveRead<WidestGap | null>> {
  const db = getDb();
  if (!db) {
    return { data: null, degradedReason: ARCHIVE_NOT_CONFIGURED };
  }

  const result = await db.execute(sql<WidestGap>`
    select symbol, premium_pct as "premiumPct", observed_at as "observedAt"
    from ${observations}
    where observed_at >= now() - interval '24 hours'
      and symbol in (${trackedSymbolSql()})
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
