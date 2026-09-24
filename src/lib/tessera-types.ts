import type { RouteTrackRecord } from "./archive";
import type { ExecutionGate } from "./gate";
import type { TesseraSnapshot } from "./tessera";

export interface TesseraDepth {
  maxFillableUsd: number | null;
  routeLabel: string | null;
  observedAt: string | null;
  degradedReason: string | null;
}

export interface TesseraWatchlistEntry {
  snapshot: TesseraSnapshot;
  depth: TesseraDepth;
  gate: ExecutionGate;
  gateReason: string;
  trackRecord: RouteTrackRecord | null;
}

export interface TesseraWatchlistResponse {
  entries: TesseraWatchlistEntry[];
  fetchedAt: string;
  retryAfterSeconds: number;
  archiveDegradedReason: string | null;
  comparisonError: string | null;
}
