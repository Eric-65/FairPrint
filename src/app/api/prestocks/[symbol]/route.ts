import { NextResponse } from "next/server";
import { getJupiterPrice } from "@/lib/market-data";
import { measureMarkedTrade, parseTradeInputs } from "@/lib/marked-trade";
import { findPreStocksAsset, isAllowedPreStocksMint } from "@/lib/prestocks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// How far PreStocks' own tokenPrice may diverge from live Jupiter Price v3
// for the same mint before FairPrint surfaces it as a data-quality signal.
const CROSS_CHECK_DIVERGENCE_PCT = 1;

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;

  let asset: Awaited<ReturnType<typeof findPreStocksAsset>>;
  try {
    asset = await findPreStocksAsset(symbol);
  } catch (error) {
    return NextResponse.json(
      {
        error: "PreStocks measurement is unavailable",
        action: "Keep this page open and retry after the source reconnects.",
        detail: error instanceof Error ? error.message : "PreStocks fetch failed",
      },
      { status: 503 },
    );
  }

  if (!asset) {
    return NextResponse.json(
      {
        error: "Ticker is not in the PreStocks allowlist",
        action: "Choose one of the tracked PreStocks assets from the watchlist.",
      },
      { status: 404 },
    );
  }

  // Hard scope enforcement: never quote, depth-check, or swap a mint that
  // isn't in the live PreStocks response, even if it was momentarily cached.
  const allowed = await isAllowedPreStocksMint(asset.mint);
  if (!allowed) {
    return NextResponse.json(
      {
        error: "Mint failed the PreStocks allowlist check",
        action: "This asset is no longer in the live PreStocks response and cannot be quoted.",
      },
      { status: 403 },
    );
  }

  try {
    const { notionalUsd, tolerancePct } = parseTradeInputs(request);
    const crossCheck = await getJupiterPrice(asset.mint);
    const { depth, cost, costDegradedReason } = await measureMarkedTrade({
      venue: "prestocks",
      symbol: asset.symbol,
      mint: asset.mint,
      markPrice: asset.markPrice,
      premiumPct: asset.premiumPct,
      decimals: crossCheck.decimals,
      notionalUsd,
      tolerancePct,
    });

    const crossCheckDivergencePct =
      crossCheck.price !== null && asset.tokenPrice !== null && asset.tokenPrice !== 0
        ? Math.abs((crossCheck.price - asset.tokenPrice) / asset.tokenPrice) * 100
        : null;

    return NextResponse.json(
      {
        asset,
        depth,
        cost,
        costDegradedReason,
        crossCheck: {
          jupiterPrice: crossCheck.price,
          tokenPrice: asset.tokenPrice,
          divergencePct: crossCheckDivergencePct,
          flagged:
            crossCheckDivergencePct !== null && crossCheckDivergencePct > CROSS_CHECK_DIVERGENCE_PCT,
          error: crossCheck.error,
        },
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
