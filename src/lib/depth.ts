import "server-only";

import { JUPITER_PRICE_URL, JUPITER_QUOTE_URL } from "./market-data";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_KEY_NAME = ["JUPITER", "API", "KEY"].join("_");
const USDC_DECIMALS = 6;
const MIN_NOTIONAL_USD = 100;
const MAX_NOTIONAL_USD = 100_000;
const SEARCH_ITERATIONS = 8;
const REQUEST_TIMEOUT_MS = 8_000;
const BASE_SIGNATURE_FEE_LAMPORTS = 5_000;

interface JupiterSwapInfo {
  label?: string;
  feeAmount?: string;
  feeMint?: string;
}

interface JupiterRouteStep {
  swapInfo?: JupiterSwapInfo;
}

interface JupiterQuoteResponse {
  outAmount?: string;
  priceImpactPct?: string;
  routePlan?: JupiterRouteStep[];
  contextSlot?: number;
  platformFee?: { amount?: string; feeBps?: number } | null;
  error?: string;
}

interface JupiterPriceResponse {
  [mint: string]: {
    usdPrice?: number;
    decimals?: number;
  } | undefined;
}

interface ParsedQuote {
  impactDecimal: number;
  routeLabel: string;
  response: JupiterQuoteResponse;
}

export interface DepthMeasurement {
  maxFillableUsd: number;
  priceImpactAt1kPct: number;
  routeLabel: string;
  probes: number;
  tolerancePct: number;
}

export interface ExecutionQuoteMeasurement {
  notionalUsd: number;
  priceImpactPct: number;
  ammFeePct: number | null;
  ammFeeUsd: number | null;
  feesItemized: boolean;
  networkFeeUsd: number;
  outputAmount: number;
  routeLabel: string;
  contextSlot: number | null;
  quotedAt: string;
}

interface DepthCacheEntry {
  expiresAt: number;
  measurement: Promise<DepthMeasurement>;
}

declare global {
  var fairPrintDepthCache: Map<string, DepthCacheEntry> | undefined;
}

const depthCache = globalThis.fairPrintDepthCache ?? new Map<string, DepthCacheEntry>();
if (process.env.NODE_ENV !== "production") globalThis.fairPrintDepthCache = depthCache;

export class UnfillableQuoteError extends Error {}

function apiHeaders() {
  const apiKey = process.env[JUPITER_KEY_NAME];
  return {
    accept: "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

function normalizeTolerance(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(0.1, Math.round(value * 10) / 10));
}

function routeLabel(routePlan: JupiterRouteStep[] | undefined) {
  if (!routePlan?.length) return "No route";
  return routePlan
    .map((step) => step.swapInfo?.label)
    .filter((label): label is string => Boolean(label))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .join(" + ") || "Unlabelled Jupiter route";
}

async function fetchQuote(
  mint: string,
  notionalUsd: number,
  tolerancePct: number,
): Promise<ParsedQuote> {
  const tolerance = normalizeTolerance(tolerancePct);
  const params = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: mint,
    amount: String(Math.round(notionalUsd * 10 ** USDC_DECIMALS)),
    slippageBps: String(Math.round(tolerance * 100)),
  });
  const response = await fetch(`${JUPITER_QUOTE_URL}?${params}`, {
    cache: "no-store",
    headers: apiHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as JupiterQuoteResponse | null;

  if (!response.ok) {
    const detail = body?.error || `Jupiter Quote returned ${response.status}`;
    if (/route|tradable|liquidity|consume|oracle/i.test(detail)) {
      throw new UnfillableQuoteError(detail);
    }
    throw new Error(detail);
  }

  const impactDecimal = Number(body?.priceImpactPct);
  if (!body?.routePlan?.length || !Number.isFinite(impactDecimal) || impactDecimal < 0) {
    throw new UnfillableQuoteError(body?.error || "Jupiter returned no auditable route");
  }

  return {
    impactDecimal,
    routeLabel: routeLabel(body.routePlan),
    response: body,
  };
}

async function fetchPrices(mints: string[]) {
  const unique = [...new Set(mints)].filter(Boolean);
  const response = await fetch(
    `${JUPITER_PRICE_URL}?ids=${encodeURIComponent(unique.join(","))}`,
    {
      cache: "no-store",
      headers: apiHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`Jupiter Price v3 returned ${response.status}`);
  return (await response.json()) as JupiterPriceResponse;
}

export async function measureDepth(
  mint: string,
  tolerancePct = 1,
): Promise<DepthMeasurement> {
  const tolerance = normalizeTolerance(tolerancePct);
  const impactLimitDecimal = tolerance / 100;
  let probes = 0;
  const quote = async (notional: number) => {
    probes += 1;
    return fetchQuote(mint, notional, tolerance);
  };

  const atOneThousand = await quote(1_000);
  const atCeiling = await quote(MAX_NOTIONAL_USD).catch((error: unknown) => {
    if (error instanceof UnfillableQuoteError) return null;
    throw error;
  });

  if (atCeiling && atCeiling.impactDecimal <= impactLimitDecimal) {
    return {
      maxFillableUsd: MAX_NOTIONAL_USD,
      priceImpactAt1kPct: atOneThousand.impactDecimal * 100,
      routeLabel: atOneThousand.routeLabel,
      probes,
      tolerancePct: tolerance,
    };
  }

  const atFloor = await quote(MIN_NOTIONAL_USD).catch((error: unknown) => {
    if (error instanceof UnfillableQuoteError) return null;
    throw error;
  });
  let low = MIN_NOTIONAL_USD;
  let high = MAX_NOTIONAL_USD;
  let best = atFloor && atFloor.impactDecimal <= impactLimitDecimal
    ? MIN_NOTIONAL_USD
    : 0;

  for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration += 1) {
    const midpoint = (low + high) / 2;
    const midpointQuote = await quote(midpoint).catch((error: unknown) => {
      if (error instanceof UnfillableQuoteError) return null;
      throw error;
    });

    if (midpointQuote && midpointQuote.impactDecimal <= impactLimitDecimal) {
      best = midpoint;
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return {
    maxFillableUsd: Math.floor(best),
    priceImpactAt1kPct: atOneThousand.impactDecimal * 100,
    routeLabel: atOneThousand.routeLabel,
    probes,
    tolerancePct: tolerance,
  };
}

export function getCachedDepth(mint: string, tolerancePct = 1) {
  const tolerance = normalizeTolerance(tolerancePct);
  const key = `${mint}:${tolerance}`;
  const cached = depthCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.measurement;

  const measurement = measureDepth(mint, tolerance).catch((error) => {
    depthCache.delete(key);
    throw error;
  });
  depthCache.set(key, { expiresAt: Date.now() + 30_000, measurement });
  return measurement;
}

export async function measureExecutionQuote(
  mint: string,
  notionalUsd: number,
  tolerancePct: number,
  outputDecimals: number,
): Promise<ExecutionQuoteMeasurement> {
  const quote = await fetchQuote(mint, notionalUsd, tolerancePct);
  const feeMints = (quote.response.routePlan ?? [])
    .map((step) => step.swapInfo?.feeMint)
    .filter((feeMint): feeMint is string => Boolean(feeMint));
  const prices = await fetchPrices([...feeMints, SOL_MINT]);
  let ammFeeUsd = 0;
  let feesItemized = true;

  for (const step of quote.response.routePlan ?? []) {
    const rawFeeAmount = step.swapInfo?.feeAmount;
    const feeMint = step.swapInfo?.feeMint;
    if (rawFeeAmount === undefined || !feeMint) {
      feesItemized = false;
      continue;
    }
    const feeAmount = Number(rawFeeAmount);
    if (!Number.isFinite(feeAmount) || feeAmount < 0) {
      feesItemized = false;
      continue;
    }
    if (feeAmount === 0) continue;
    if (feeMint === USDC_MINT) {
      ammFeeUsd += feeAmount / 10 ** USDC_DECIMALS;
      continue;
    }
    const feePrice = prices[feeMint]?.usdPrice;
    const feeDecimals = feeMint === mint ? outputDecimals : prices[feeMint]?.decimals;
    if (feePrice !== undefined && feeDecimals !== undefined) {
      ammFeeUsd += (feeAmount / 10 ** feeDecimals) * feePrice;
    } else {
      feesItemized = false;
    }
  }

  const solPrice = prices[SOL_MINT]?.usdPrice;
  if (solPrice === undefined) {
    throw new Error("Jupiter did not return SOL/USD for the network-fee estimate");
  }
  const outputRaw = Number(quote.response.outAmount);
  if (!Number.isFinite(outputRaw)) throw new Error("Jupiter quote omitted output amount");

  return {
    notionalUsd,
    priceImpactPct: quote.impactDecimal * 100,
    ammFeePct: feesItemized ? (ammFeeUsd / notionalUsd) * 100 : null,
    ammFeeUsd: feesItemized ? ammFeeUsd : null,
    feesItemized,
    networkFeeUsd: (BASE_SIGNATURE_FEE_LAMPORTS / 1_000_000_000) * solPrice,
    outputAmount: outputRaw / 10 ** outputDecimals,
    routeLabel: quote.routeLabel,
    contextSlot: quote.response.contextSlot ?? null,
    quotedAt: new Date().toISOString(),
  };
}
