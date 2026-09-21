import "server-only";

import { JUPITER_PRICE_URL, JUPITER_QUOTE_URL } from "./market-data";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_KEY_NAME = ["JUPITER", "API", "KEY"].join("_");
const USDC_DECIMALS = 6;
const MIN_NOTIONAL_USD = 100;
const MAX_NOTIONAL_USD = 100_000;
// Jupiter budgets are tight (30/min keyless, 60/min free key), so the search
// is seeded from the 1k impact and capped at 7 probes per mint:
// 1k, seed, up to 3 expansions, then 2 bisections.
const EXPANSION_FACTOR = 4;
const MAX_EXPANSION_PROBES = 3;
const MAX_REFINEMENT_PROBES = 2;
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
export class RateLimitedError extends Error {}

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

  if (response.status === 429) {
    throw new RateLimitedError("Jupiter Quote returned 429 (rate limit reached)");
  }
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
  const tryQuote = (notional: number) =>
    quote(notional).catch((error: unknown) => {
      if (error instanceof UnfillableQuoteError) return null;
      throw error;
    });
  const fits = (parsed: ParsedQuote | null) =>
    parsed !== null && parsed.impactDecimal <= impactLimitDecimal;
  const finish = (best: number) => ({
    maxFillableUsd: Math.floor(best),
    priceImpactAt1kPct: atOneThousand.impactDecimal * 100,
    routeLabel: atOneThousand.routeLabel,
    probes,
    tolerancePct: tolerance,
  });

  // Bracket [low, high] where low is known to fit and high is known not to.
  let low: number;
  let high: number;

  if (!fits(atOneThousand)) {
    // Thin route: the answer lies below $1k, if anywhere.
    if (!fits(await tryQuote(MIN_NOTIONAL_USD))) return finish(0);
    low = MIN_NOTIONAL_USD;
    high = 1_000;
  } else {
    // Impact grows roughly linearly with size on AMM routes, so extrapolate
    // from the 1k reading, then expand geometrically until a probe fails.
    const projected = atOneThousand.impactDecimal > 0
      ? (1_000 * impactLimitDecimal) / atOneThousand.impactDecimal
      : MAX_NOTIONAL_USD;
    const seed = Math.min(MAX_NOTIONAL_USD, Math.max(2_000, projected * 0.75));

    if (fits(await tryQuote(seed))) {
      low = seed;
      high = MAX_NOTIONAL_USD;
      let bracketed = false;
      for (let expansion = 0; expansion < MAX_EXPANSION_PROBES && low < MAX_NOTIONAL_USD; expansion += 1) {
        const next = Math.min(MAX_NOTIONAL_USD, low * EXPANSION_FACTOR);
        if (fits(await tryQuote(next))) {
          low = next;
        } else {
          high = next;
          bracketed = true;
          break;
        }
      }
      if (low >= MAX_NOTIONAL_USD) return finish(MAX_NOTIONAL_USD);
      // Expansion budget ran out below the ceiling without a failing probe:
      // report the largest verified size rather than spend more requests.
      if (!bracketed) return finish(low);
    } else {
      low = 1_000;
      high = seed;
    }
  }

  for (let iteration = 0; iteration < MAX_REFINEMENT_PROBES; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (fits(await tryQuote(midpoint))) low = midpoint;
    else high = midpoint;
  }

  return finish(low);
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
