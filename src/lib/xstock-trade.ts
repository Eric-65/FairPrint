import "server-only";

import { describeArchiveError, getLatestArchivedLiquidity } from "./archive";
import { measureExecutionQuote } from "./depth";
import { getCachedLiquidity } from "./liquidity";
import { getTickerSnapshot, resolveXStockMint } from "./market-data";
import type { TrackedAsset } from "./tracked-assets";

// Premium, 1% depth and all-in cost at size for one xStock — shared by the
// trade check page and the agent API so both give the same answer.
export async function measureXStockTrade(tracked: TrackedAsset, notionalUsd: number, tolerancePct: number) {
  const mint = tracked.mint ?? await resolveXStockMint(tracked.symbol);
  const [snapshot, liveDepth, archivedResult] = await Promise.all([
    getTickerSnapshot(tracked.symbol),
    getCachedLiquidity(mint, tolerancePct),
    getLatestArchivedLiquidity().catch((error: unknown) => {
      console.error("[FairPrint] Archive read failed", { symbol: tracked.symbol, error });
      return { data: [], degradedReason: describeArchiveError(error) };
    }),
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
        mint,
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
  return {
    snapshot,
    depth,
    cost,
    costDegradedReason:
      executionResult.error ??
      (quote && !quote.feesItemized
        ? "Jupiter Lite includes AMM fees in executable output but does not itemize them on this route."
        : null),
  };
}
