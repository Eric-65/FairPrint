import { NextResponse } from "next/server";
import { describeArchiveError, getLatestArchivedLiquidity } from "@/lib/archive";
import { measureExecutionQuote } from "@/lib/depth";
import { getCachedLiquidity } from "@/lib/liquidity";
import { getJupiterPrice } from "@/lib/market-data";
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
    const url = new URL(request.url);
    const requestedNotional = Number(url.searchParams.get("notional") ?? 1_000);
    const requestedTolerance = Number(url.searchParams.get("slippage") ?? 1);
    const notionalUsd = Math.min(100_000, Math.max(100, requestedNotional || 1_000));
    const tolerancePct = Math.min(5, Math.max(0.1, requestedTolerance || 1));

    const [liveDepth, archivedResult, crossCheck] = await Promise.all([
      getCachedLiquidity(asset.mint, tolerancePct),
      getLatestArchivedLiquidity("prestocks", [asset.symbol]).catch((error: unknown) => {
        console.error("[FairPrint prestocks] Archive read failed", { error });
        return { data: [], degradedReason: describeArchiveError(error) };
      }),
      getJupiterPrice(asset.mint),
    ]);

    const archived = archivedResult.data.find((reading) => reading.symbol === asset.symbol);
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
      poolVolume24hUsd: liveDepth.poolVolume24hUsd ?? archived?.poolVolume24hUsd ?? null,
      source: usesArchivedDepth ? ("archive" as const) : ("live" as const),
      observedAt: usesArchivedDepth
        ? new Date(archived!.observedAt).toISOString()
        : new Date().toISOString(),
    };

    const executionResult =
      crossCheck.decimals === null
        ? { quote: null, error: "Jupiter did not publish token decimals for cost calculation" }
        : await measureExecutionQuote(
            asset.mint,
            notionalUsd,
            tolerancePct,
            crossCheck.decimals,
          ).then(
            (quote) => ({ quote, error: null as string | null }),
            (error: unknown) => {
              const message = error instanceof Error ? error.message : "Entered-size quote failed";
              console.error("[FairPrint prestocks] Entered-size quote failed", {
                symbol: asset.symbol,
                notionalUsd,
                tolerancePct,
                error,
              });
              return { quote: null, error: message };
            },
          );

    const quote = executionResult.quote;
    const canValueOutput = quote && asset.markPrice !== null;
    const componentCostPct =
      quote && quote.ammFeePct !== null && asset.premiumPct !== null
        ? asset.premiumPct + quote.priceImpactPct + quote.ammFeePct
        : null;
    const allInUsd =
      quote && asset.markPrice !== null
        ? notionalUsd - quote.outputAmount * asset.markPrice + quote.networkFeeUsd
        : componentCostPct !== null && quote
          ? (componentCostPct / 100) * notionalUsd + quote.networkFeeUsd
          : null;
    const cost =
      quote && asset.premiumPct !== null && allInUsd !== null
        ? {
            notionalUsd,
            premiumPct: asset.premiumPct,
            priceImpactPct: quote.priceImpactPct,
            ammFeePct: quote.ammFeePct,
            ammFeeUsd: quote.ammFeeUsd,
            feesItemized: quote.feesItemized,
            networkFeeUsd: quote.networkFeeUsd,
            allInPct: (allInUsd / notionalUsd) * 100,
            allInUsd,
            executableOutput: quote.outputAmount,
            executableOutputReferenceValue: canValueOutput
              ? quote.outputAmount * asset.markPrice!
              : null,
            computation: quote.feesItemized
              ? "(premium + price impact + AMM fee) * notional + network fee"
              : "notional - (executable output * markPrice) + network fee",
            routeLabel: quote.routeLabel,
            contextSlot: quote.contextSlot,
            quotedAt: quote.quotedAt,
          }
        : null;

    const crossCheckDivergencePct =
      crossCheck.price !== null && asset.tokenPrice !== null && asset.tokenPrice !== 0
        ? Math.abs((crossCheck.price - asset.tokenPrice) / asset.tokenPrice) * 100
        : null;

    return NextResponse.json(
      {
        asset,
        depth,
        cost,
        costDegradedReason:
          executionResult.error ??
          (quote && !quote.feesItemized
            ? "Jupiter Lite includes AMM fees in executable output but does not itemize them on this route."
            : null),
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
