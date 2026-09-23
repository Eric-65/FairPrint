import "server-only";

const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30_000;
// impliedValuation/markValuation must reproduce tokenPrice/markPrice within this
// relative tolerance, or the row is untrustworthy per the sanity check in the spec.
const VALUATION_MISMATCH_TOLERANCE_PCT = 0.5;

interface PreStocksApiAsset {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  external_url?: string;
  contract_address?: string;
  markPrice?: number;
  markValuation?: number;
  tokenPrice?: number;
  impliedValuation?: number;
  supply?: number;
}

export interface PreStocksAsset {
  symbol: string;
  name: string;
  description: string | null;
  image: string | null;
  externalUrl: string | null;
  mint: string;
  markPrice: number | null;
  markValuation: number | null;
  tokenPrice: number | null;
  impliedValuation: number | null;
  supply: number | null;
  premiumPct: number | null;
  fetchedAt: string;
  degraded: boolean;
  degradedReason: string | null;
}

interface PreStocksCacheEntry {
  expiresAt: number;
  assets: Promise<PreStocksAsset[]>;
}

declare global {
  var fairPrintPreStocksCache: PreStocksCacheEntry | undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatUpstreamError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function parseAsset(raw: PreStocksApiAsset, fetchedAt: string): PreStocksAsset | null {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim() : "";
  const mint = typeof raw.contract_address === "string" ? raw.contract_address.trim() : "";
  if (!symbol || !mint) return null;

  const markPrice = finiteNumber(raw.markPrice);
  const tokenPrice = finiteNumber(raw.tokenPrice);
  const markValuation = finiteNumber(raw.markValuation);
  const impliedValuation = finiteNumber(raw.impliedValuation);
  const supply = finiteNumber(raw.supply);

  const premiumPct =
    markPrice !== null && markPrice > 0 && tokenPrice !== null
      ? ((tokenPrice - markPrice) / markPrice) * 100
      : null;

  const degradedReasons: string[] = [];
  if (markPrice === null || markPrice <= 0) {
    degradedReasons.push("PreStocks did not publish a usable markPrice");
  }
  if (tokenPrice === null) {
    degradedReasons.push("PreStocks did not publish a usable tokenPrice");
  }

  if (
    markPrice !== null &&
    markPrice > 0 &&
    tokenPrice !== null &&
    markValuation !== null &&
    markValuation > 0 &&
    impliedValuation !== null
  ) {
    const priceRatio = tokenPrice / markPrice;
    const valuationRatio = impliedValuation / markValuation;
    const relativeGapPct =
      (Math.abs(priceRatio - valuationRatio) / Math.max(Math.abs(priceRatio), 1e-9)) * 100;
    if (relativeGapPct > VALUATION_MISMATCH_TOLERANCE_PCT) {
      degradedReasons.push(
        `impliedValuation/markValuation (${valuationRatio.toFixed(4)}) does not match tokenPrice/markPrice (${priceRatio.toFixed(4)})`,
      );
    }
  }

  return {
    symbol,
    name: typeof raw.name === "string" && raw.name ? raw.name : symbol,
    description: typeof raw.description === "string" ? raw.description : null,
    image: typeof raw.image === "string" ? raw.image : null,
    externalUrl: typeof raw.external_url === "string" ? raw.external_url : null,
    mint,
    markPrice,
    markValuation,
    tokenPrice,
    impliedValuation,
    supply,
    premiumPct,
    fetchedAt,
    degraded: degradedReasons.length > 0,
    degradedReason: degradedReasons.length > 0 ? degradedReasons.join("; ") : null,
  };
}

async function fetchPreStocksAssets(): Promise<PreStocksAsset[]> {
  let response: Response;
  try {
    response = await fetch(PRESTOCKS_API_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(formatUpstreamError(error, "PreStocks API request failed"));
  }
  if (!response.ok) throw new Error(`PreStocks API returned ${response.status}`);

  const body = (await response.json()) as PreStocksApiAsset[] | { data?: PreStocksApiAsset[] };
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  const fetchedAt = new Date().toISOString();

  const seenMints = new Set<string>();
  const assets: PreStocksAsset[] = [];
  for (const raw of rows) {
    const asset = parseAsset(raw, fetchedAt);
    if (!asset || seenMints.has(asset.mint)) continue;
    seenMints.add(asset.mint);
    assets.push(asset);
  }
  return assets;
}

/**
 * The live PreStocks response IS the allowlist: only mints present in the
 * latest fetch may ever be quoted, swapped, or depth-checked in this section.
 */
export function getCachedPreStocksAssets(): Promise<PreStocksAsset[]> {
  const cached = globalThis.fairPrintPreStocksCache;
  if (cached && cached.expiresAt > Date.now()) return cached.assets;

  const assets = fetchPreStocksAssets().catch((error: unknown) => {
    globalThis.fairPrintPreStocksCache = undefined;
    throw error;
  });
  globalThis.fairPrintPreStocksCache = { expiresAt: Date.now() + CACHE_TTL_MS, assets };
  return assets;
}

export async function findPreStocksAsset(symbol: string): Promise<PreStocksAsset | null> {
  const assets = await getCachedPreStocksAssets();
  return assets.find((asset) => asset.symbol.toLowerCase() === symbol.toLowerCase()) ?? null;
}

export async function isAllowedPreStocksMint(mint: string): Promise<boolean> {
  const assets = await getCachedPreStocksAssets();
  return assets.some((asset) => asset.mint === mint);
}
