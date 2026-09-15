import type { ExecutionGate } from "./gate";
import type { TickerSnapshot } from "./market-data";

export interface WatchlistDepth {
  maxFillableUsd: number | null;
  priceImpactAt1kPct: number | null;
  routeLabel: string | null;
  poolTvlUsd: number | null;
  poolVolume24hUsd: number | null;
  observedAt: string | null;
  degradedReason: string | null;
}

export interface WatchlistEntry {
  symbol: string;
  liquidityClass: "liquid" | "thin";
  snapshot: TickerSnapshot | null;
  error: string | null;
  depth: WatchlistDepth;
  gate: ExecutionGate;
  gateReason: string;
}

export interface WatchlistResponse {
  entries: WatchlistEntry[];
  widestGap24h: {
    symbol: string;
    premiumPct: number;
    observedAt: string;
  } | null;
  observedAt: string;
  retryAfterSeconds: number;
  archiveDegradedReason: string | null;
}
