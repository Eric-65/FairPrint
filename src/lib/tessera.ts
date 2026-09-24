import "server-only";

import { getJupiterPriceChecks } from "./market-data";
import { getCachedPreStocksAssets, type PreStocksAsset } from "./prestocks";

const TESSERA_API_URL = "https://rest-api.tessera.pe/v1/public/token-details";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30_000;

interface TesseraApiToken {
  id?: string;
  name?: string;
  symbol?: string;
  code?: string;
  sector?: string;
  mint?: string;
  markPrice?: number;
  holders?: number;
  markValuation?: number;
}

export interface TesseraToken {
  symbol: string;
  name: string;
  company: string;
  sector: string | null;
  mint: string;
  markPrice: number | null;
  markValuation: number | null;
  holders: number | null;
  fetchedAt: string;
}

export interface VenueValuation {
  symbol: string;
  livePrice: number | null;
  priceSource: "Jupiter Price v3" | "PreStocks tokenPrice" | null;
  markPrice: number | null;
  markValuation: number | null;
  // The company valuation implied by paying livePrice for one token.
  impliedValuation: number | null;
}

export interface TesseraComparison {
  prestocks: VenueValuation;
  // Positive when the T-Token prices the company lower, i.e. cheaper exposure.
  tesseraDiscountPct: number | null;
}

export interface TesseraSnapshot {
  token: TesseraToken;
  onchainPrice: number | null;
  premiumPct: number | null;
  impliedValuation: number | null;
  jupiterBlockId: number | null;
  tokenDecimals: number | null;
  comparison: TesseraComparison | null;
  degradedReason: string | null;
}

interface TesseraCacheEntry {
  expiresAt: number;
  tokens: Promise<TesseraToken[]>;
}

declare global {
  var fairPrintTesseraCache: TesseraCacheEntry | undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// "T-OpenAI" and PreStocks' "OPENAI" both key to "openai".
function companyKey(symbol: string) {
  return symbol.replace(/^t-/i, "").toLowerCase();
}

function parseToken(raw: TesseraApiToken, fetchedAt: string): TesseraToken | null {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim() : "";
  const mint = typeof raw.mint === "string" ? raw.mint.trim() : "";
  if (!symbol || !mint) return null;
  const name = typeof raw.name === "string" && raw.name ? raw.name : symbol;
  const markPrice = finiteNumber(raw.markPrice);
  const markValuation = finiteNumber(raw.markValuation);

  return {
    symbol,
    name,
    company: name.replace(/^T-/, ""),
    sector: typeof raw.sector === "string" ? raw.sector : null,
    mint,
    markPrice: markPrice !== null && markPrice > 0 ? markPrice : null,
    markValuation: markValuation !== null && markValuation > 0 ? markValuation : null,
    holders: finiteNumber(raw.holders),
    fetchedAt,
  };
}

async function fetchTesseraTokens(): Promise<TesseraToken[]> {
  let response: Response;
  try {
    response = await fetch(TESSERA_API_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Tessera API request failed");
  }
  if (!response.ok) throw new Error(`Tessera API returned ${response.status}`);

  const body = (await response.json()) as TesseraApiToken[] | { data?: TesseraApiToken[] };
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  const fetchedAt = new Date().toISOString();
  const seenMints = new Set<string>();
  const tokens: TesseraToken[] = [];
  for (const raw of rows) {
    const token = parseToken(raw, fetchedAt);
    if (!token || seenMints.has(token.mint)) continue;
    seenMints.add(token.mint);
    tokens.push(token);
  }
  return tokens;
}

/**
 * The live Tessera response is the allowlist: only mints it returns may be
 * quoted or depth-checked from the Tessera section.
 */
export function getCachedTesseraTokens(): Promise<TesseraToken[]> {
  const cached = globalThis.fairPrintTesseraCache;
  if (cached && cached.expiresAt > Date.now()) return cached.tokens;

  const tokens = fetchTesseraTokens().catch((error: unknown) => {
    globalThis.fairPrintTesseraCache = undefined;
    throw error;
  });
  globalThis.fairPrintTesseraCache = { expiresAt: Date.now() + CACHE_TTL_MS, tokens };
  return tokens;
}

export async function isAllowedTesseraMint(mint: string) {
  const tokens = await getCachedTesseraTokens();
  return tokens.some((token) => token.mint === mint);
}

function impliedValuation(price: number | null, markPrice: number | null, markValuation: number | null) {
  return price !== null && markPrice !== null && markValuation !== null
    ? (price / markPrice) * markValuation
    : null;
}

function preStocksValuation(
  asset: PreStocksAsset,
  jupiterPrice: number | null,
): VenueValuation {
  const livePrice = jupiterPrice ?? asset.tokenPrice;
  return {
    symbol: asset.symbol,
    livePrice,
    priceSource: jupiterPrice !== null
      ? "Jupiter Price v3"
      : asset.tokenPrice !== null
        ? "PreStocks tokenPrice"
        : null,
    markPrice: asset.markPrice,
    markValuation: asset.markValuation,
    impliedValuation: impliedValuation(livePrice, asset.markPrice, asset.markValuation),
  };
}

export async function getTesseraSnapshots(): Promise<{
  snapshots: TesseraSnapshot[];
  comparisonError: string | null;
}> {
  const tokens = await getCachedTesseraTokens();
  const preStocks = await getCachedPreStocksAssets().then(
    (assets) => ({ assets, error: null as string | null }),
    (error: unknown) => ({
      assets: [] as PreStocksAsset[],
      error: error instanceof Error ? error.message : "PreStocks fetch failed",
    }),
  );
  const preStocksByCompany = new Map(
    preStocks.assets.map((asset) => [companyKey(asset.symbol), asset]),
  );
  const matched = tokens.map((token) => preStocksByCompany.get(companyKey(token.symbol)) ?? null);
  const prices = await getJupiterPriceChecks([
    ...tokens.map((token) => token.mint),
    ...matched.flatMap((asset) => (asset ? [asset.mint] : [])),
  ]);

  const snapshots = tokens.map((token, index) => {
    const price = prices.get(token.mint);
    const onchainPrice = price?.price ?? null;
    const premiumPct = onchainPrice !== null && token.markPrice !== null
      ? ((onchainPrice - token.markPrice) / token.markPrice) * 100
      : null;
    const tesseraImplied = impliedValuation(onchainPrice, token.markPrice, token.markValuation);
    const preStocksAsset = matched[index];
    const prestocks = preStocksAsset
      ? preStocksValuation(preStocksAsset, prices.get(preStocksAsset.mint)?.price ?? null)
      : null;
    const degraded: string[] = [];
    if (token.markPrice === null) degraded.push("Tessera did not publish a usable markPrice");
    if (onchainPrice === null) degraded.push(price?.error ?? "Jupiter did not return a live price");

    return {
      token,
      onchainPrice,
      premiumPct,
      impliedValuation: tesseraImplied,
      jupiterBlockId: price?.blockId ?? null,
      tokenDecimals: price?.decimals ?? null,
      comparison: prestocks
        ? {
            prestocks,
            tesseraDiscountPct:
              tesseraImplied !== null && prestocks.impliedValuation !== null
                ? ((prestocks.impliedValuation - tesseraImplied) / prestocks.impliedValuation) * 100
                : null,
          }
        : null,
      degradedReason: degraded.length ? degraded.join("; ") : null,
    };
  });

  return { snapshots, comparisonError: preStocks.error };
}

export async function findTesseraSnapshot(symbol: string) {
  const { snapshots } = await getTesseraSnapshots();
  return snapshots.find((snapshot) => snapshot.token.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}
