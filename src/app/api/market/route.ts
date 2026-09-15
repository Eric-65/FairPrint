import { NextResponse } from "next/server";
import {
  getLatestArchivedLiquidity,
  getWidestGap24h,
  type ArchivedLiquidity,
} from "@/lib/archive";
import { decideExecutionGate } from "@/lib/gate";
import { getTickerSnapshots } from "@/lib/market-data";
import { TRACKED_ASSETS } from "@/lib/tracked-assets";
import type { WatchlistEntry, WatchlistResponse } from "@/lib/watchlist-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function dateString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET() {
  const observedAt = new Date().toISOString();
  const [snapshots, archiveResult] = await Promise.all([
    getTickerSnapshots(TRACKED_ASSETS),
    Promise.all([getLatestArchivedLiquidity(), getWidestGap24h()]).then(
      ([liquidity, widest]) => ({
        liquidity: liquidity.data,
        widest: widest.data,
        error: liquidity.degradedReason ?? widest.degradedReason,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : "Archive query failed";
        console.error("[FairPrint watchlist] Archive read failed", { error });
        return {
          liquidity: [] as ArchivedLiquidity[],
          widest: null,
          error: message,
        };
      },
    ),
  ]);
  const liquidityBySymbol = new Map(
    archiveResult.liquidity.map((reading) => [reading.symbol, reading]),
  );
  const snapshotBySymbol = new Map(
    snapshots.map((result) => [result.symbol, result]),
  );

  const entries: WatchlistEntry[] = TRACKED_ASSETS.map((asset) => {
    const result = snapshotBySymbol.get(asset.symbol);
    const snapshot = result?.snapshot ?? null;
    const archived = liquidityBySymbol.get(asset.symbol);
    const maxFillableUsd = archived?.depth1PctUsd ?? null;
    const decision = decideExecutionGate({
      premiumPct: snapshot?.premiumPct ?? null,
      maxFillableUsd,
      notionalUsd: 1_000,
      halted: snapshot?.market.halted ?? false,
    });

    return {
      symbol: asset.symbol,
      liquidityClass: asset.liquidityClass,
      snapshot,
      error: result?.error ?? null,
      depth: {
        maxFillableUsd,
        priceImpactAt1kPct: archived?.priceImpactAt1kPct ?? null,
        routeLabel: archived?.routeLabel ?? null,
        poolTvlUsd: archived?.poolTvlUsd ?? null,
        poolVolume24hUsd: archived?.poolVolume24hUsd ?? null,
        observedAt: dateString(archived?.observedAt),
        degradedReason: archived?.degradedReason ?? archiveResult.error,
      },
      gate: decision.gate,
      gateReason: decision.reason,
    };
  }).sort((a, b) => {
    const aPremium = a.snapshot?.premiumPct;
    const bPremium = b.snapshot?.premiumPct;
    if (aPremium === null || aPremium === undefined) return 1;
    if (bPremium === null || bPremium === undefined) return -1;
    return Math.abs(bPremium) - Math.abs(aPremium);
  });

  const response: WatchlistResponse = {
    entries,
    widestGap24h: archiveResult.widest
      ? {
          symbol: archiveResult.widest.symbol,
          premiumPct: archiveResult.widest.premiumPct,
          observedAt: dateString(archiveResult.widest.observedAt)!,
        }
      : null,
    observedAt,
    retryAfterSeconds: 15,
    archiveDegradedReason: archiveResult.error,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
    },
  });
}
