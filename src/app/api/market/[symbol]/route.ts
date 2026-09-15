import { NextResponse } from "next/server";
import { getLatestArchivedLiquidity } from "@/lib/archive";
import { measureExecutionQuote } from "@/lib/depth";
import { getCachedLiquidity } from "@/lib/liquidity";
import { getTickerSnapshot } from "@/lib/market-data";
import { findTrackedAsset } from "@/lib/tracked-assets";

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
        action: "Choose one of the 20 tracked xStocks from the mispricing watch.",
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
    const [snapshot, liveDepth, archivedResult] = await Promise.all([
      getTickerSnapshot(tracked.symbol),
      getCachedLiquidity(tracked.mint, tolerancePct),
      getLatestArchivedLiquidity().catch((error: unknown) => ({
        data: [],
        degradedReason:
          error instanceof Error ? error.message : "Archive query failed",
      })),
    ]);
    const archived = archivedResult.data.find(
      (reading) => reading.symbol === tracked.symbol,
    );
    const usesArchivedDepth =
      tolerancePct === 1 &&
      liveDepth.depth1PctUsd === null &&
      archived?.depth1PctUsd !== null &&
      archived?.depth1PctUsd !== undefined;
    const depth = {
      ...liveDepth,
      depth1PctUsd: usesArchivedDepth ? archived!.depth1PctUsd : liveDepth.depth1PctUsd,
      priceImpactAt1kPct: usesArchivedDepth
        ? archived!.priceImpactAt1kPct
        : liveDepth.priceImpactAt1kPct,
      routeLabel: usesArchivedDepth ? archived!.routeLabel : liveDepth.routeLabel,
      poolTvlUsd: liveDepth.poolTvlUsd ?? archived?.poolTvlUsd ?? null,
      poolVolume24hUsd:
        liveDepth.poolVolume24hUsd ?? archived?.poolVolume24hUsd ?? null,
      source: usesArchivedDepth ? "archive" : "live",
      observedAt: usesArchivedDepth
        ? new Date(archived!.observedAt).toISOString()
        : new Date().toISOString(),
    };
    const executionResult = snapshot.source.tokenDecimals === null
      ? { quote: null, error: "Jupiter did not publish token decimals for cost calculation" }
      : await measureExecutionQuote(
          tracked.mint,
          notionalUsd,
          tolerancePct,
          snapshot.source.tokenDecimals,
        ).then(
          (quote) => ({ quote, error: null as string | null }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : "Entered-size quote failed";
            console.error("[FairPrint] Entered-size quote failed", {
              symbol: tracked.symbol,
              notionalUsd,
              tolerancePct,
              error,
            });
            return { quote: null, error: message };
          },
        );
    const quote = executionResult.quote;
    const canValueOutput = quote && snapshot.referencePrice !== null;
    const componentCostPct =
      quote && quote.ammFeePct !== null && snapshot.premiumPct !== null
        ? snapshot.premiumPct + quote.priceImpactPct + quote.ammFeePct
        : null;
    const allInUsd = quote && snapshot.referencePrice !== null
      ? notionalUsd - quote.outputAmount * snapshot.referencePrice + quote.networkFeeUsd
      : componentCostPct !== null && quote
        ? (componentCostPct / 100) * notionalUsd + quote.networkFeeUsd
        : null;
    const cost = quote && snapshot.premiumPct !== null && allInUsd !== null
      ? {
          notionalUsd,
          premiumPct: snapshot.premiumPct,
          priceImpactPct: quote.priceImpactPct,
          ammFeePct: quote.ammFeePct,
          ammFeeUsd: quote.ammFeeUsd,
          feesItemized: quote.feesItemized,
          networkFeeUsd: quote.networkFeeUsd,
          allInPct: (allInUsd / notionalUsd) * 100,
          allInUsd,
          executableOutput: quote.outputAmount,
          executableOutputReferenceValue: canValueOutput
            ? quote.outputAmount * snapshot.referencePrice!
            : null,
          computation: quote.feesItemized
            ? "(premium + price impact + AMM fee) * notional + network fee"
            : "notional - (executable output * reference price) + network fee",
          routeLabel: quote.routeLabel,
          contextSlot: quote.contextSlot,
          quotedAt: quote.quotedAt,
        }
      : null;
    return NextResponse.json(
      {
        snapshot,
        depth,
        cost,
        costDegradedReason:
          executionResult.error ??
          (quote && !quote.feesItemized
            ? "Jupiter Lite includes AMM fees in executable output but does not itemize them on this route."
            : null),
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
