import "server-only";

import { describeArchiveError, getLatestArchivedLiquidity, getLatestArchivedPrice } from "./archive";
import { measureExecutionQuote } from "./depth";
import { getCachedLiquidity, type LiquidityMeasurement } from "./liquidity";
import { getTickerSnapshot, resolveXStockMint, type TickerSnapshot } from "./market-data";
import type { TrackedAsset } from "./tracked-assets";

const XSTOCK_DECIMALS = 8;

function minutesAgo(date: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return minutes === 0 ? "under a minute" : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// When this request's own Jupiter price call fails (usually the keyless rate
// limit), use the minute poller's newest reading so the premium stays measured.
async function withArchivedPriceFallback(snapshot: TickerSnapshot) {
  if (snapshot.onchainPrice !== null) return { snapshot, priceSource: "live" as const, priceObservedAt: null };
  const archived = await getLatestArchivedPrice(snapshot.symbol).catch((error: unknown) => {
    console.error("[FairPrint] Archived price read failed", { symbol: snapshot.symbol, error });
    return null;
  });
  if (!archived) return { snapshot, priceSource: "live" as const, priceObservedAt: null };

  const referencePrice = snapshot.referencePrice ?? archived.referencePrice;
  const premiumPct = referencePrice !== null
    ? ((archived.onchainPrice - referencePrice) / referencePrice) * 100
    : archived.premiumPct;
  const note = `Live Jupiter price unavailable; using the on-chain price recorded ${minutesAgo(archived.observedAt)} ago`;
  return {
    snapshot: {
      ...snapshot,
      onchainPrice: archived.onchainPrice,
      referencePrice,
      premiumPct,
      degraded: { onchain: false, reference: referencePrice === null, reason: note },
    },
    priceSource: "archive" as const,
    priceObservedAt: archived.observedAt.toISOString(),
  };
}

// Premium, 1% depth and all-in cost at size for one xStock — shared by the
// trade check page and the agent API so both give the same answer. The agent
// API sets preferArchivedDepth: the poller re-measures depth on a rotation, so
// it skips the ~7 live Jupiter probes whenever a fresh reading exists.
export async function measureXStockTrade(
  tracked: TrackedAsset,
  notionalUsd: number,
  tolerancePct: number,
  options: { preferArchivedDepth?: boolean } = {},
) {
  const mint = tracked.mint ?? await resolveXStockMint(tracked.symbol);
  const [liveSnapshot, archivedResult] = await Promise.all([
    getTickerSnapshot(tracked.symbol),
    getLatestArchivedLiquidity("xstocks", [tracked.symbol]).catch((error: unknown) => {
      console.error("[FairPrint] Archive read failed", { symbol: tracked.symbol, error });
      return { data: [], degradedReason: describeArchiveError(error) };
    }),
  ]);
  const archivedDepth = archivedResult.data.find((reading) => reading.symbol === tracked.symbol);
  const skipLiveDepth = Boolean(
    options.preferArchivedDepth && tolerancePct === 1 && archivedDepth?.depth1PctUsd != null,
  );
  const [priced, liveDepth] = await Promise.all([
    withArchivedPriceFallback(liveSnapshot),
    skipLiveDepth
      ? Promise.resolve<LiquidityMeasurement>({
          routeLabel: null,
          poolTvlUsd: null,
          poolVolume24hUsd: null,
          depth1PctUsd: null,
          priceImpactAt1kPct: null,
          probes: 0,
          tolerancePct,
          rateLimited: false,
          degradedReasons: [],
        })
      : getCachedLiquidity(mint, tolerancePct),
  ]);
  const { snapshot, priceSource, priceObservedAt } = priced;
  const archived = archivedDepth;
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
  // Every xStock mint uses 8 decimals; Jupiter's figure is preferred when present.
  const tokenDecimals = snapshot.source.tokenDecimals ?? XSTOCK_DECIMALS;
  const executionResult = await measureExecutionQuote(mint, notionalUsd, tolerancePct, tokenDecimals).then(
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
    priceSource,
    priceObservedAt,
    depth,
    cost,
    costDegradedReason:
      executionResult.error ??
      (quote && !quote.feesItemized
        ? "Jupiter Lite includes AMM fees in executable output but does not itemize them on this route."
        : null),
  };
}
