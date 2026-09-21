import "server-only";

import { measureDepth, RateLimitedError } from "./depth";

const METEORA_POOLS_URL = "https://dlmm.datapi.meteora.ag/pools";
const REQUEST_TIMEOUT_MS = 8_000;

interface MeteoraPool {
  tvl?: number;
  is_blacklisted?: boolean;
  token_x?: { address?: string };
  token_y?: { address?: string };
  volume?: { "24h"?: number };
}

interface MeteoraPoolsResponse {
  data?: MeteoraPool[];
}

export interface LiquidityMeasurement {
  routeLabel: string | null;
  poolTvlUsd: number | null;
  poolVolume24hUsd: number | null;
  depth1PctUsd: number | null;
  priceImpactAt1kPct: number | null;
  probes: number;
  tolerancePct: number;
  rateLimited: boolean;
  degradedReasons: string[];
}

interface LiquidityCacheEntry {
  expiresAt: number;
  measurement: Promise<LiquidityMeasurement>;
}

declare global {
  var fairPrintLiquidityCache: Map<string, LiquidityCacheEntry> | undefined;
}

const liquidityCache = globalThis.fairPrintLiquidityCache ?? new Map<string, LiquidityCacheEntry>();
if (process.env.NODE_ENV !== "production") globalThis.fairPrintLiquidityCache = liquidityCache;

function formatError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function measureMeteora(mint: string) {
  const params = new URLSearchParams({ query: mint, page_size: "100" });
  const response = await fetch(`${METEORA_POOLS_URL}?${params}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Meteora DLMM returned ${response.status}`);

  const body = (await response.json()) as MeteoraPoolsResponse;
  const matchingPools = (body.data ?? []).filter(
    (pool) =>
      !pool.is_blacklisted &&
      (pool.token_x?.address === mint || pool.token_y?.address === mint),
  );

  return matchingPools.reduce(
    (total, pool) => ({
      poolTvlUsd: total.poolTvlUsd + (Number.isFinite(pool.tvl) ? pool.tvl! : 0),
      poolVolume24hUsd:
        total.poolVolume24hUsd +
        (Number.isFinite(pool.volume?.["24h"]) ? pool.volume!["24h"]! : 0),
    }),
    { poolTvlUsd: 0, poolVolume24hUsd: 0 },
  );
}

export async function measureLiquidity(
  mint: string,
  tolerancePct = 1,
): Promise<LiquidityMeasurement> {
  const [depthResult, meteoraResult] = await Promise.allSettled([
    measureDepth(mint, tolerancePct),
    measureMeteora(mint),
  ]);
  const degradedReasons: string[] = [];

  if (depthResult.status === "rejected") {
    const reason = formatError(depthResult.reason, "Jupiter depth measurement failed");
    console.error("[FairPrint archive] Jupiter depth measurement failed", { mint, error: depthResult.reason });
    degradedReasons.push(`Jupiter depth: ${reason}`);
  }
  if (meteoraResult.status === "rejected") {
    const reason = formatError(meteoraResult.reason, "Meteora pool measurement failed");
    console.error("[FairPrint archive] Meteora measurement failed", { mint, error: meteoraResult.reason });
    degradedReasons.push(`Meteora: ${reason}`);
  }

  return {
    routeLabel: depthResult.status === "fulfilled" ? depthResult.value.routeLabel : null,
    depth1PctUsd:
      depthResult.status === "fulfilled" ? depthResult.value.maxFillableUsd : null,
    priceImpactAt1kPct:
      depthResult.status === "fulfilled" ? depthResult.value.priceImpactAt1kPct : null,
    probes: depthResult.status === "fulfilled" ? depthResult.value.probes : 0,
    tolerancePct:
      depthResult.status === "fulfilled" ? depthResult.value.tolerancePct : tolerancePct,
    poolTvlUsd: meteoraResult.status === "fulfilled" ? meteoraResult.value.poolTvlUsd : null,
    poolVolume24hUsd:
      meteoraResult.status === "fulfilled" ? meteoraResult.value.poolVolume24hUsd : null,
    rateLimited:
      depthResult.status === "rejected" && depthResult.reason instanceof RateLimitedError,
    degradedReasons,
  };
}

export function getCachedLiquidity(mint: string, tolerancePct = 1) {
  const key = `${mint}:${tolerancePct}`;
  const cached = liquidityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.measurement;

  const measurement = measureLiquidity(mint, tolerancePct).catch((error) => {
    liquidityCache.delete(key);
    throw error;
  });
  liquidityCache.set(key, {
    expiresAt: Date.now() + 30_000,
    measurement,
  });
  return measurement;
}
