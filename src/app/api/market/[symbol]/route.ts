import { NextResponse } from "next/server";
import { findTrackedAsset } from "@/lib/tracked-assets";
import { measureXStockTrade } from "@/lib/xstock-trade";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const tracked = findTrackedAsset(symbol);

  if (!tracked) {
    return NextResponse.json(
      {
        error: "Ticker is not in the FairPrint watchlist",
        action: "Choose one of the tracked xStocks from the mispricing watch.",
      },
      { status: 404 },
    );
  }

  try {
    const url = new URL(_request.url);
    const requestedNotional = Number(url.searchParams.get("notional") ?? 1_000);
    const requestedTolerance = Number(url.searchParams.get("slippage") ?? 1);
    const notionalUsd = Math.min(100_000, Math.max(100, requestedNotional || 1_000));
    const tolerancePct = Math.min(5, Math.max(0.1, requestedTolerance || 1));
    const trade = await measureXStockTrade(tracked, notionalUsd, tolerancePct);
    return NextResponse.json(
      {
        ...trade,
        notionalUsd,
        tolerancePct,
        measuredAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
        },
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown upstream response";
    return NextResponse.json(
      {
        error: "Live trade measurement is unavailable",
        action: "Keep this page open and retry after the source reconnects.",
        detail,
      },
      { status: 503 },
    );
  }
}
