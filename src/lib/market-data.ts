const XSTOCKS_BASE_URL = "https://api.xstocks.fi/api/v2";
const JUPITER_KEY_NAME = ["JUPITER", "API", "KEY"].join("_");
// Keyless lite-api is capped at 30 requests/min (and deprecated); a free key
// from portal.jup.ag raises that to 60/min but must be sent to api.jup.ag.
const JUPITER_HOST = process.env[JUPITER_KEY_NAME]
  ? "https://api.jup.ag"
  : "https://lite-api.jup.ag";
export const JUPITER_PRICE_URL = `${JUPITER_HOST}/price/v3`;
export const JUPITER_QUOTE_URL = `${JUPITER_HOST}/swap/v1/quote`;
export const JUPITER_TOKENS_URL = `${JUPITER_HOST}/tokens/v2/search`;

export function jupiterHeaders(): Record<string, string> {
  const apiKey = process.env[JUPITER_KEY_NAME];
  return apiKey ? { accept: "application/json", "x-api-key": apiKey } : { accept: "application/json" };
}

const HERMES_BASE_URL = "https://hermes.pyth.network";
const REQUEST_TIMEOUT_MS = 8_000;
const PYTH_KEY_NAME = ["PYTH", "API", "KEY"].join("_");

export type GateState = "fair" | "caution" | "overpay" | "unavailable";
export type MarketPeriod = "market" | "extended" | "overnight" | "closed";

interface StablecoinDeployment {
  symbol: string;
  address: string;
  decimals: number;
  network: string;
}

interface Deployment {
  address: string;
  network: string;
  supportsAtomicSwaps: boolean;
  stablecoins?: StablecoinDeployment[];
}

interface XStocksAsset {
  name: string;
  symbol: string;
  underlyingSymbol: string;
  isTradingHalted: boolean;
  underlying?: {
    symbol: string;
    listingCountry: string | null;
  } | null;
  trading?: {
    currentPeriod: MarketPeriod;
    openNow: boolean;
    nextChangeAt: string | null;
    isTradingHalted: boolean;
    exchange: {
      abbreviation: string;
      name: string;
      timezone: string;
    } | null;
  } | null;
  deployments: Deployment[];
}

interface OracleNode {
  network: string;
  managedBy: string;
  metadata?: {
    hermesId?: string;
    pythLazerId?: number;
    exponent?: number;
  };
}

interface OracleResponse {
  nodes: OracleNode[];
}

interface JupiterStockData {
  id?: string;
  price?: number;
  mcap?: number;
  updatedAt?: string;
}

interface JupiterPriceEntry {
  usdPrice?: number;
  blockId?: number;
  decimals?: number;
  liquidity?: number;
  stockData?: JupiterStockData;
}

interface JupiterPriceResponse {
  [mint: string]: JupiterPriceEntry | undefined;
}

interface JupiterPriceResult {
  value: JupiterPriceResponse;
  error: string | null;
}

interface HermesPrice {
  price: string;
  conf: string;
  expo: number;
  publish_time: number;
}

interface HermesPriceUpdate {
  id: string;
  price: HermesPrice;
  ema_price?: HermesPrice;
}

interface HermesResponse {
  parsed?: HermesPriceUpdate[];
}

interface ReferenceReading {
  price: number | null;
  confidence: number | null;
  updatedAt: string | null;
  error: string | null;
}

export interface TickerSnapshot {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  mint: string;
  onchainPrice: number | null;
  referencePrice: number | null;
  premiumPct: number | null;
  referenceConfidence: {
    absolute: number | null;
    lower: number | null;
    upper: number | null;
    percent: number | null;
  };
  state: GateState;
  market: {
    period: MarketPeriod;
    open: boolean;
    halted: boolean;
    nextChangeAt: string | null;
    exchange: string;
    timezone: string;
  };
  source: {
    asset: "xStocks Public API";
    onchain: "Jupiter Price v3";
    reference: "xStocks Public API" | "Pyth Hermes" | "Jupiter stockData" | null;
    oracleManager: string | null;
    pythFeedId: string | null;
    jupiterBlockId: number | null;
    tokenDecimals: number | null;
  };
  freshness: {
    fetchedAt: string;
    referenceUpdatedAt: string | null;
    pythPublishedAt: string | null;
  };
  degraded: {
    onchain: boolean;
    reference: boolean;
    reason: string | null;
  };
}

async function fetchJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  }

  return (await response.json()) as T;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatUpstreamError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function fetchJupiterPrices(mints: readonly string[]): Promise<JupiterPriceResult> {
  const uniqueMints = [...new Set(mints)].slice(0, 50);
  const apiKey = process.env[JUPITER_KEY_NAME];

  try {
    const value = await fetchJson<JupiterPriceResponse>(
      `${JUPITER_PRICE_URL}?ids=${encodeURIComponent(uniqueMints.join(","))}`,
      apiKey ? { "x-api-key": apiKey } : undefined,
    );
    return { value, error: null };
  } catch (error) {
    console.error("[FairPrint] Jupiter Price v3 request failed", {
      mints: uniqueMints,
      endpoint: JUPITER_PRICE_URL,
      error,
    });
    return {
      value: {},
      error: formatUpstreamError(error, "Jupiter Price v3 request failed"),
    };
  }
}

function scalePythValue(value: string, exponent: number): number | null {
  const parsed = Number(value);
  const scaled = parsed * 10 ** exponent;
  return Number.isFinite(scaled) ? scaled : null;
}

export function gateState(premium: number | null): GateState {
  if (premium === null) return "unavailable";
  const deviation = Math.abs(premium);
  if (deviation < 0.5) return "fair";
  if (deviation <= 2) return "caution";
  return "overpay";
}

async function fetchHermesReference(feedId: string): Promise<ReferenceReading> {
  // Since the Pyth Core upgrade (26 Aug 2026) Hermes rejects unauthenticated
  // requests with 401. Register at Pyth Terminal and set PYTH_API_KEY.
  const apiKey = process.env[PYTH_KEY_NAME];
  if (!apiKey) {
    return {
      price: null,
      confidence: null,
      updatedAt: null,
      error: `Pyth Hermes requires ${PYTH_KEY_NAME} (unset)`,
    };
  }

  try {
    const response = await fetchJson<HermesResponse>(
      `${HERMES_BASE_URL}/v2/updates/price/latest?ids%5B%5D=${encodeURIComponent(feedId)}`,
      { authorization: `Bearer ${apiKey}` },
    );
    const update = response.parsed?.find(
      (item) => item.id.replace(/^0x/, "").toLowerCase() === feedId.replace(/^0x/, "").toLowerCase(),
    );

    if (!update) {
      return {
        price: null,
        confidence: null,
        updatedAt: null,
        error: "Pyth Hermes omitted the requested feed",
      };
    }

    const price = scalePythValue(update.price.price, update.price.expo);
    const confidence = scalePythValue(update.price.conf, update.price.expo);
    const publishTime = Number(update.price.publish_time);
    const updatedAt = Number.isFinite(publishTime) && publishTime > 0
      ? new Date(publishTime * 1_000).toISOString()
      : null;

    if (price === null || price <= 0 || confidence === null || confidence < 0 || !updatedAt) {
      return {
        price: null,
        confidence: null,
        updatedAt: null,
        error: "Pyth Hermes returned an invalid price, confidence, or publish time",
      };
    }

    return { price, confidence, updatedAt, error: null };
  } catch (error) {
    return {
      price: null,
      confidence: null,
      updatedAt: null,
      error: formatUpstreamError(error, "Pyth Hermes request failed"),
    };
  }
}

export async function getTickerSnapshot(
  symbol = "TSLAx",
  prefetchedJupiter?: JupiterPriceResult,
): Promise<TickerSnapshot> {
  const safeSymbol = /^[A-Z0-9]+x$/i.test(symbol) ? symbol : "TSLAx";
  const asset = await fetchJson<XStocksAsset>(
    `${XSTOCKS_BASE_URL}/public/assets/${encodeURIComponent(safeSymbol)}`,
  );
  const solana = asset.deployments.find((deployment) => deployment.network === "Solana");

  if (!solana) {
    throw new Error(`${asset.symbol} has no verified Solana deployment`);
  }

  const oracleResult = await fetchJson<OracleResponse>(
    `${XSTOCKS_BASE_URL}/public/oracles/${encodeURIComponent(asset.symbol)}`,
  ).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({
      value: { nodes: [] } as OracleResponse,
      error: formatUpstreamError(error, "xStocks oracle metadata request failed"),
    }),
  );
  const pythOracle = oracleResult.value.nodes.find(
    (oracle) => oracle.network === "Solana" && oracle.managedBy === "Pyth",
  );
  const hermesId = pythOracle?.metadata?.hermesId ?? null;

  const issuerReferencePromise = fetchJson<{ quote: number | null }>(
    `${XSTOCKS_BASE_URL}/public/assets/${encodeURIComponent(asset.symbol)}/price-data`,
  ).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({
      value: { quote: null },
      error: formatUpstreamError(error, "xStocks issuer quote request failed"),
    }),
  );
  const jupiterPromise = prefetchedJupiter
    ? Promise.resolve(prefetchedJupiter)
    : fetchJupiterPrices([solana.address]);
  const hermesPromise = hermesId
    ? fetchHermesReference(hermesId)
    : Promise.resolve<ReferenceReading>({
        price: null,
        confidence: null,
        updatedAt: null,
        error: oracleResult.error ?? "xStocks did not publish a Solana Pyth feed ID",
      });

  const [issuerResult, jupiterResult, hermes] = await Promise.all([
    issuerReferencePromise,
    jupiterPromise,
    hermesPromise,
  ]);

  const jupiter = jupiterResult.value[solana.address];
  const onchainPrice = finiteNumber(jupiter?.usdPrice);
  const issuerQuote = finiteNumber(issuerResult.value.quote);
  // Jupiter publishes the underlying stock's reference price alongside the
  // on-chain quote for xStocks mints. It is the last resort when both the
  // issuer quote and Pyth are unavailable.
  const jupiterStockQuote = finiteNumber(jupiter?.stockData?.price);
  const jupiterStockUpdatedAt = jupiter?.stockData?.updatedAt ?? null;
  const referencePrice = issuerQuote ?? hermes.price ?? jupiterStockQuote;
  const usesHermes = issuerQuote === null && hermes.price !== null;
  const usesJupiterStock = issuerQuote === null && hermes.price === null && jupiterStockQuote !== null;
  const referenceSource = issuerQuote !== null
    ? "xStocks Public API" as const
    : usesHermes
      ? "Pyth Hermes" as const
      : usesJupiterStock
        ? "Jupiter stockData" as const
        : null;
  const referenceConfidence = hermes.confidence;
  const confidenceLower = referencePrice !== null && referenceConfidence !== null
    ? referencePrice - referenceConfidence
    : null;
  const confidenceUpper = referencePrice !== null && referenceConfidence !== null
    ? referencePrice + referenceConfidence
    : null;
  const confidencePercent = referencePrice !== null && referenceConfidence !== null
    ? (referenceConfidence / referencePrice) * 100
    : null;
  const premiumPct = onchainPrice !== null && referencePrice !== null
    ? ((onchainPrice - referencePrice) / referencePrice) * 100
    : null;
  const missing: string[] = [];

  if (onchainPrice === null) {
    missing.push(jupiterResult.error ?? "Jupiter did not return a reliable last-swap price");
  }
  if (referencePrice === null) {
    const referenceFailures = [
      issuerResult.error ?? "the issuer quote is unavailable in the current market period",
      hermes.error ?? oracleResult.error,
      "Jupiter stockData carried no reference price",
    ].filter((reason): reason is string => Boolean(reason));
    missing.push(referenceFailures.join("; ") || "no reference price source returned a value");
  }

  return {
    symbol: asset.symbol,
    name: asset.name,
    underlyingSymbol: asset.underlying?.symbol || asset.underlyingSymbol,
    mint: solana.address,
    onchainPrice,
    referencePrice,
    premiumPct,
    referenceConfidence: {
      absolute: referenceConfidence,
      lower: confidenceLower,
      upper: confidenceUpper,
      percent: confidencePercent,
    },
    state: gateState(premiumPct),
    market: {
      period: asset.trading?.currentPeriod ?? "closed",
      open: asset.trading?.currentPeriod === "market",
      halted: asset.isTradingHalted || asset.trading?.isTradingHalted || false,
      nextChangeAt: asset.trading?.nextChangeAt ?? null,
      exchange: asset.trading?.exchange?.abbreviation ?? "US market",
      timezone: asset.trading?.exchange?.timezone ?? "America/New_York",
    },
    source: {
      asset: "xStocks Public API",
      onchain: "Jupiter Price v3",
      reference: referenceSource,
      oracleManager: pythOracle?.managedBy ?? null,
      pythFeedId: hermesId,
      jupiterBlockId: jupiter?.blockId ?? null,
      tokenDecimals: jupiter?.decimals ?? null,
    },
    freshness: {
      fetchedAt: new Date().toISOString(),
      referenceUpdatedAt: usesHermes
        ? hermes.updatedAt
        : usesJupiterStock
          ? jupiterStockUpdatedAt
          : null,
      pythPublishedAt: hermes.updatedAt,
    },
    degraded: {
      onchain: onchainPrice === null,
      reference: referencePrice === null,
      reason: missing.length ? missing.join("; ") : null,
    },
  };
}

export interface JupiterPriceCheck {
  price: number | null;
  blockId: number | null;
  decimals: number | null;
  error: string | null;
}

export async function getJupiterPriceChecks(
  mints: readonly string[],
): Promise<Map<string, JupiterPriceCheck>> {
  const result = await fetchJupiterPrices(mints);
  return new Map(
    mints.map((mint) => {
      const entry = result.value[mint];
      return [mint, {
        price: finiteNumber(entry?.usdPrice),
        blockId: entry?.blockId ?? null,
        decimals: entry?.decimals ?? null,
        error: result.error ?? (entry ? null : "Jupiter Price v3 returned no price for this mint"),
      }];
    }),
  );
}

export async function getJupiterPrice(mint: string): Promise<JupiterPriceCheck> {
  const result = await fetchJupiterPrices([mint]);
  const entry = result.value[mint];
  return {
    price: finiteNumber(entry?.usdPrice),
    blockId: entry?.blockId ?? null,
    decimals: entry?.decimals ?? null,
    error: result.error,
  };
}

// Mint addresses never change for a symbol, so a successful lookup is kept for
// the life of the process; failures are dropped so the next call retries.
const xStockMintCache = new Map<string, Promise<string>>();

export function resolveXStockMint(symbol: string): Promise<string> {
  const cached = xStockMintCache.get(symbol);
  if (cached) return cached;

  const mint = fetchJson<XStocksAsset>(
    `${XSTOCKS_BASE_URL}/public/assets/${encodeURIComponent(symbol)}`,
  ).then((asset) => {
    const solana = asset.deployments.find((deployment) => deployment.network === "Solana");
    if (!solana) throw new Error(`${symbol} has no verified Solana deployment`);
    return solana.address;
  });
  mint.catch(() => xStockMintCache.delete(symbol));
  xStockMintCache.set(symbol, mint);
  return mint;
}

export async function withResolvedMints<T extends { symbol: string; mint: string | null }>(
  assets: readonly T[],
): Promise<T[]> {
  return Promise.all(
    assets.map(async (asset) => {
      if (asset.mint) return asset;
      try {
        return { ...asset, mint: await resolveXStockMint(asset.symbol) };
      } catch (error) {
        console.error("[FairPrint] xStocks mint lookup failed", { symbol: asset.symbol, error });
        return asset;
      }
    }),
  );
}

export interface TickerSnapshotResult {
  symbol: string;
  snapshot: TickerSnapshot | null;
  error: string | null;
}

export async function getTickerSnapshots(
  unresolvedAssets: readonly { symbol: string; mint: string | null }[],
): Promise<TickerSnapshotResult[]> {
  const assets = await withResolvedMints(unresolvedAssets);
  const jupiter = await fetchJupiterPrices(
    assets.flatMap((asset) => (asset.mint ? [asset.mint] : [])),
  );

  return Promise.all(
    assets.map(async (asset, index) => {
      try {
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, index * 700));
        }
        const snapshot = await getTickerSnapshot(asset.symbol, jupiter);
        return { symbol: asset.symbol, snapshot, error: null };
      } catch (error) {
        const message = formatUpstreamError(error, "Fair-value measurement failed");
        console.error("[FairPrint] Ticker snapshot failed", {
          symbol: asset.symbol,
          mint: asset.mint,
          error,
        });
        return { symbol: asset.symbol, snapshot: null, error: message };
      }
    }),
  );
}
