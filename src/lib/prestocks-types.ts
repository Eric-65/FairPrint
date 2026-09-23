import type { ExecutionGate } from "./gate";
import type { PreStocksAsset } from "./prestocks";

export interface PreStocksDepth {
  maxFillableUsd: number | null;
  priceImpactAt1kPct: number | null;
  routeLabel: string | null;
  poolTvlUsd: number | null;
  poolVolume24hUsd: number | null;
  observedAt: string | null;
  degradedReason: string | null;
}

export interface PreStocksWatchlistEntry {
  symbol: string;
  name: string;
  image: string | null;
  asset: PreStocksAsset;
  depth: PreStocksDepth;
  gate: ExecutionGate;
  gateReason: string;
}

export interface PreStocksWatchlistResponse {
  entries: PreStocksWatchlistEntry[];
  fetchedAt: string;
  retryAfterSeconds: number;
  archiveDegradedReason: string | null;
}
