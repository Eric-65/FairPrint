import { NextResponse } from "next/server";
import { checkXStockForAgent } from "@/lib/agent-check";
import { findTrackedAsset, TRACKED_ASSETS } from "@/lib/tracked-assets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Agents call this from anywhere, including browser-based runtimes.
const CORS = { "Access-Control-Allow-Origin": "*" };

export function OPTIONS() {
  return new NextResponse(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const tracked = findTrackedAsset(symbol);
  if (!tracked) {
    return NextResponse.json(
      {
        error: symbol ? `${symbol} is not a tracked xStock` : "Missing ?symbol=",
        action: "Pass one of the supported symbols, e.g. ?symbol=TSLAx&notional=1000.",
        symbols: TRACKED_ASSETS.map((asset) => asset.symbol),
      },
      { status: symbol ? 404 : 400, headers: CORS },
    );
  }

  const requestedNotional = Number(url.searchParams.get("notional") ?? 1_000);
  const requestedTolerance = Number(url.searchParams.get("slippage") ?? 1);
  const notionalUsd = Math.min(100_000, Math.max(100, requestedNotional || 1_000));
  const tolerancePct = Math.min(5, Math.max(0.1, requestedTolerance || 1));

  try {
    const check = await checkXStockForAgent(tracked, notionalUsd, tolerancePct);
    return NextResponse.json(check, {
      headers: { ...CORS, "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        verdict: "unavailable",
        proceed: false,
        error: "Live measurement is unavailable",
        action: "Do not trade on this check; retry in 15 seconds.",
        detail: error instanceof Error ? error.message : "Unknown upstream response",
      },
      { status: 503, headers: CORS },
    );
  }
}
