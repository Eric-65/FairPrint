import "server-only";

import { decideExecutionGate, type ExecutionGate } from "./gate";
import type { TrackedAsset } from "./tracked-assets";
import { measureXStockTrade } from "./xstock-trade";

export interface AgentCheck {
  symbol: string;
  underlying: string;
  mint: string;
  notionalUsd: number;
  tolerancePct: number;
  // The single field an agent should branch on.
  verdict: ExecutionGate;
  proceed: boolean;
  reason: string;
  premiumPct: number | null;
  onchainPrice: number | null;
  // "archive" when the live price call failed and the minute poller's newest
  // reading (at most 5 minutes old, see priceObservedAt) was used instead.
  priceSource: "live" | "archive";
  priceObservedAt: string | null;
  referencePrice: number | null;
  referenceSource: string | null;
  depth1PctUsd: number | null;
  depthObservedAt: string | null;
  allInCostUsd: number | null;
  allInCostPct: number | null;
  market: { period: string; open: boolean; halted: boolean };
  route: string | null;
  measuredAt: string;
  degraded: string | null;
}

// FairPrint's gate reduced to what an autonomous agent needs before it buys a
// tokenized stock: one verdict, whether to proceed, and the numbers behind it.
export async function checkXStockForAgent(
  tracked: TrackedAsset,
  notionalUsd: number,
  tolerancePct: number,
): Promise<AgentCheck> {
  const { snapshot, priceSource, priceObservedAt, depth, cost, costDegradedReason } = await measureXStockTrade(
    tracked,
    notionalUsd,
    tolerancePct,
    { preferArchivedDepth: true },
  );
  const decision = decideExecutionGate({
    premiumPct: snapshot.premiumPct,
    maxFillableUsd: depth.depth1PctUsd,
    notionalUsd,
    halted: snapshot.market.halted,
  });
  const degraded = [snapshot.degraded.reason, ...depth.degradedReasons, costDegradedReason]
    .filter((reason): reason is string => Boolean(reason));

  return {
    symbol: snapshot.symbol,
    underlying: snapshot.underlyingSymbol,
    mint: snapshot.mint,
    notionalUsd,
    tolerancePct,
    verdict: decision.gate,
    proceed: decision.gate === "fair",
    reason: decision.reason,
    premiumPct: snapshot.premiumPct,
    onchainPrice: snapshot.onchainPrice,
    priceSource,
    priceObservedAt,
    referencePrice: snapshot.referencePrice,
    referenceSource: snapshot.source.reference,
    depth1PctUsd: depth.depth1PctUsd,
    depthObservedAt: depth.depth1PctUsd === null ? null : depth.observedAt,
    allInCostUsd: cost?.allInUsd ?? null,
    allInCostPct: cost?.allInPct ?? null,
    market: {
      period: snapshot.market.period,
      open: snapshot.market.open,
      halted: snapshot.market.halted,
    },
    route: cost?.routeLabel ?? depth.routeLabel,
    measuredAt: new Date().toISOString(),
    degraded: degraded.length > 0 ? degraded.join("; ") : null,
  };
}
