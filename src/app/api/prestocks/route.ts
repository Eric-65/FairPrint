import { NextResponse } from "next/server";
import { describeArchiveError, getLatestArchivedLiquidity } from "@/lib/archive";
import { decideExecutionGate } from "@/lib/gate";
import { getCachedPreStocksAssets } from "@/lib/prestocks";
import type { PreStocksWatchlistEntry, PreStocksWatchlistResponse } from "@/lib/prestocks-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function dateString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET() {
  const fetchedAt = new Date().toISOString();

  let assets: Awaited<ReturnType<typeof getCachedPreStocksAssets>>;
  let fetchError: string | null = null;
  try {
    assets = await getCachedPreStocksAssets();
  } catch (error) {
    assets = [];
    fetchError = error instanceof Error ? error.message : "PreStocks fetch failed";
  }

  const archiveResult = await getLatestArchivedLiquidity(
    "prestocks",
    assets.map((asset) => asset.symbol),
  ).catch((error: unknown) => {
    console.error("[FairPrint prestocks] Archive read failed", { error });
    return { data: [], degradedReason: describeArchiveError(error) };
  });
  const liquidityBySymbol = new Map(
    archiveResult.data.map((reading) => [reading.symbol, reading]),
  );

  const entries: PreStocksWatchlistEntry[] = assets
    .map((asset) => {
      const archived = liquidityBySymbol.get(asset.symbol);
      const maxFillableUsd = archived?.depth1PctUsd ?? null;
      const decision = decideExecutionGate({
        premiumPct: asset.premiumPct,
        maxFillableUsd,
        notionalUsd: 1_000,
        halted: false,
      });

      return {
        symbol: asset.symbol,
        name: asset.name,
        image: asset.image,
        asset,
        depth: {
          maxFillableUsd,
          priceImpactAt1kPct: archived?.priceImpactAt1kPct ?? null,
          routeLabel: archived?.routeLabel ?? null,
          poolTvlUsd: archived?.poolTvlUsd ?? null,
          poolVolume24hUsd: archived?.poolVolume24hUsd ?? null,
          observedAt: dateString(archived?.observedAt),
          degradedReason: archived?.degradedReason ?? archiveResult.degradedReason,
        },
        gate: decision.gate,
        gateReason: decision.reason,
      };
    })
    .sort((a, b) => {
      const aPremium = a.asset.premiumPct;
      const bPremium = b.asset.premiumPct;
      if (aPremium === null) return 1;
      if (bPremium === null) return -1;
      return Math.abs(bPremium) - Math.abs(aPremium);
    });

  const response: PreStocksWatchlistResponse = {
    entries,
    fetchedAt,
    retryAfterSeconds: 15,
    archiveDegradedReason: fetchError ?? archiveResult.degradedReason,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
    },
  });
}
