import { NextResponse } from "next/server";
import { describeArchiveError, getLatestArchivedLiquidity, getRouteTrackRecords } from "@/lib/archive";
import { decideExecutionGate } from "@/lib/gate";
import { getTesseraSnapshots, type TesseraSnapshot } from "@/lib/tessera";
import type { TesseraWatchlistEntry, TesseraWatchlistResponse } from "@/lib/tessera-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function dateString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET() {
  const fetchedAt = new Date().toISOString();

  let snapshots: TesseraSnapshot[] = [];
  let comparisonError: string | null = null;
  let fetchError: string | null = null;
  try {
    ({ snapshots, comparisonError } = await getTesseraSnapshots());
  } catch (error) {
    fetchError = error instanceof Error ? error.message : "Tessera fetch failed";
  }

  const archiveResult = await getLatestArchivedLiquidity(
    "tessera",
    snapshots.map(({ token }) => token.symbol),
  ).catch((error: unknown) => {
    console.error("[FairPrint tessera] Archive read failed", { error });
    return { data: [], degradedReason: describeArchiveError(error) };
  });
  const liquidityBySymbol = new Map(archiveResult.data.map((reading) => [reading.symbol, reading]));
  const trackRecords = await getRouteTrackRecords("7d").catch((error: unknown) => {
    console.error("[FairPrint tessera] Track record read failed", { error });
    return { data: [], degradedReason: describeArchiveError(error) };
  });
  const trackBySymbol = new Map(trackRecords.data.map((record) => [record.symbol, record]));

  const entries: TesseraWatchlistEntry[] = snapshots
    .map((snapshot) => {
      const archived = liquidityBySymbol.get(snapshot.token.symbol);
      const maxFillableUsd = archived?.depth1PctUsd ?? null;
      const decision = decideExecutionGate({
        premiumPct: snapshot.premiumPct,
        maxFillableUsd,
        notionalUsd: 1_000,
        halted: false,
      });
      return {
        snapshot,
        depth: {
          maxFillableUsd,
          routeLabel: archived?.routeLabel ?? null,
          observedAt: dateString(archived?.observedAt),
          degradedReason: archived?.degradedReason ?? archiveResult.degradedReason,
        },
        gate: decision.gate,
        gateReason: decision.reason,
        trackRecord:
          trackBySymbol.get(snapshot.token.symbol)?.compareSymbol === snapshot.comparison?.prestocks.symbol
            ? (trackBySymbol.get(snapshot.token.symbol) ?? null)
            : null,
      };
    })
    .sort((a, b) => {
      const aPremium = a.snapshot.premiumPct;
      const bPremium = b.snapshot.premiumPct;
      if (aPremium === null) return 1;
      if (bPremium === null) return -1;
      return Math.abs(bPremium) - Math.abs(aPremium);
    });

  const response: TesseraWatchlistResponse = {
    entries,
    fetchedAt,
    retryAfterSeconds: 15,
    archiveDegradedReason: fetchError ?? archiveResult.degradedReason,
    comparisonError,
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" },
  });
}
