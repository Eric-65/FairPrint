import "server-only";

import { describeArchiveError, getLatestArchivedLiquidity, type ObservationVenue } from "./archive";
import { measureExecutionQuote } from "./depth";
import { getCachedLiquidity } from "./liquidity";

interface MarkedTradeInput {
  venue: ObservationVenue;
  symbol: string;
  mint: string;
  // The venue's own valuation mark per token, used as the cost reference.
  markPrice: number | null;
  premiumPct: number | null;
  decimals: number | null;
  notionalUsd: number;
  tolerancePct: number;
}

// Live depth and an entered-size quote for a token whose reference is a
// venue-published mark (PreStocks, Tessera) rather than a stock print.
export async function measureMarkedTrade(input: MarkedTradeInput) {
  const { venue, symbol, mint, markPrice, premiumPct, decimals, notionalUsd, tolerancePct } = input;
  const [liveDepth, archivedResult, executionResult] = await Promise.all([
    getCachedLiquidity(mint, tolerancePct),
    getLatestArchivedLiquidity(venue, [symbol]).catch((error: unknown) => {
      console.error(`[FairPrint ${venue}] Archive read failed`, { error });
      return { data: [], degradedReason: describeArchiveError(error) };
    }),
    decimals === null
      ? Promise.resolve({ quote: null, error: "Jupiter did not publish token decimals for cost calculation" })
      : measureExecutionQuote(mint, notionalUsd, tolerancePct, decimals).then(
          (quote) => ({ quote, error: null as string | null }),
          (error: unknown) => {
            const message = error instanceof Error ? error.message : "Entered-size quote failed";
            console.error(`[FairPrint ${venue}] Entered-size quote failed`, {
              symbol,
              notionalUsd,
              tolerancePct,
              error,
            });
            return { quote: null, error: message };
          },
        ),
  ]);

  const archived = archivedResult.data.find((reading) => reading.symbol === symbol);
  const usesArchivedDepth =
    tolerancePct === 1 &&
    liveDepth.depth1PctUsd === null &&
    archived?.depth1PctUsd !== null &&
    archived?.depth1PctUsd !== undefined;
  const depth = {
    ...liveDepth,
    depth1PctUsd: usesArchivedDepth ? archived!.depth1PctUsd : liveDepth.depth1PctUsd,
    priceImpactAt1kPct: usesArchivedDepth ? archived!.priceImpactAt1kPct : liveDepth.priceImpactAt1kPct,
    routeLabel: usesArchivedDepth ? archived!.routeLabel : liveDepth.routeLabel,
    poolTvlUsd: liveDepth.poolTvlUsd ?? archived?.poolTvlUsd ?? null,
    poolVolume24hUsd: liveDepth.poolVolume24hUsd ?? archived?.poolVolume24hUsd ?? null,
    source: usesArchivedDepth ? ("archive" as const) : ("live" as const),
    observedAt: usesArchivedDepth
      ? new Date(archived!.observedAt).toISOString()
      : new Date().toISOString(),
  };

  const quote = executionResult.quote;
  const componentCostPct =
    quote && quote.ammFeePct !== null && premiumPct !== null
      ? premiumPct + quote.priceImpactPct + quote.ammFeePct
      : null;
  const allInUsd =
    quote && markPrice !== null
      ? notionalUsd - quote.outputAmount * markPrice + quote.networkFeeUsd
      : componentCostPct !== null && quote
        ? (componentCostPct / 100) * notionalUsd + quote.networkFeeUsd
        : null;
  const cost =
    quote && premiumPct !== null && allInUsd !== null
      ? {
          notionalUsd,
          premiumPct,
          priceImpactPct: quote.priceImpactPct,
          ammFeePct: quote.ammFeePct,
          ammFeeUsd: quote.ammFeeUsd,
          feesItemized: quote.feesItemized,
          networkFeeUsd: quote.networkFeeUsd,
          allInPct: (allInUsd / notionalUsd) * 100,
          allInUsd,
          executableOutput: quote.outputAmount,
          executableOutputReferenceValue: markPrice !== null ? quote.outputAmount * markPrice : null,
          computation: quote.feesItemized
            ? "(premium + price impact + AMM fee) * notional + network fee"
            : "notional - (executable output * markPrice) + network fee",
          routeLabel: quote.routeLabel,
          contextSlot: quote.contextSlot,
          quotedAt: quote.quotedAt,
        }
      : null;

  return {
    depth,
    cost,
    costDegradedReason:
      executionResult.error ??
      (quote && !quote.feesItemized
        ? "Jupiter Lite includes AMM fees in executable output but does not itemize them on this route."
        : null),
  };
}

export function parseTradeInputs(request: Request) {
  const url = new URL(request.url);
  const requestedNotional = Number(url.searchParams.get("notional") ?? 1_000);
  const requestedTolerance = Number(url.searchParams.get("slippage") ?? 1);
  return {
    notionalUsd: Math.min(100_000, Math.max(100, requestedNotional || 1_000)),
    tolerancePct: Math.min(5, Math.max(0.1, requestedTolerance || 1)),
  };
}
