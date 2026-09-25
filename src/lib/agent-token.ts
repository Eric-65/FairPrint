import "server-only";

import { getCachedDepth } from "./depth";
import {
  getJupiterPrice,
  getTickerSnapshot,
  JUPITER_TOKENS_URL,
  jupiterHeaders,
  resolveXStockMint,
} from "./market-data";
import { findTrackedAsset } from "./tracked-assets";

const REQUEST_TIMEOUT_MS = 8_000;

// The FairPrint Agent token is launched through Clawpump into a Meteora pool
// quoted in a tokenized stock. Its addresses are deployment settings, so the
// page goes live the moment the launch is done — no code change needed.
export interface AgentTokenConfig {
  mint: string;
  quoteSymbol: string;
  poolAddress: string | null;
  clawpumpUrl: string | null;
}

export function agentTokenConfig(): AgentTokenConfig | null {
  const mint = process.env.AGENT_TOKEN_MINT?.trim();
  if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const quote = findTrackedAsset(process.env.AGENT_QUOTE_SYMBOL?.trim() || "TSLAx");
  const clawpumpUrl = process.env.CLAWPUMP_AGENT_URL?.trim() ?? "";
  return {
    mint,
    quoteSymbol: quote?.symbol ?? "TSLAx",
    poolAddress: process.env.AGENT_POOL_ADDRESS?.trim() || null,
    clawpumpUrl: /^https:\/\//.test(clawpumpUrl) ? clawpumpUrl : null,
  };
}

interface JupiterTokenStats {
  priceChange?: number;
  buyVolume?: number;
  sellVolume?: number;
}

interface JupiterToken {
  id?: string;
  name?: string;
  symbol?: string;
  icon?: string;
  decimals?: number;
  usdPrice?: number;
  liquidity?: number;
  holderCount?: number;
  mcap?: number;
  launchpad?: string;
  bondingCurve?: number;
  firstPool?: { id?: string; createdAt?: string };
  stats24h?: JupiterTokenStats;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchTokenInfo(mint: string): Promise<JupiterToken | null> {
  const response = await fetch(`${JUPITER_TOKENS_URL}?query=${encodeURIComponent(mint)}`, {
    cache: "no-store",
    headers: jupiterHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Jupiter Tokens returned ${response.status}`);
  const rows = (await response.json()) as JupiterToken[];
  return (Array.isArray(rows) ? rows : []).find((row) => row.id === mint) ?? null;
}

function reason(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function getAgentTokenReport(config: AgentTokenConfig) {
  const quoteTracked = findTrackedAsset(config.quoteSymbol)!;
  const quoteMint = quoteTracked.mint ?? await resolveXStockMint(quoteTracked.symbol);
  const [info, price, quote, depth] = await Promise.allSettled([
    fetchTokenInfo(config.mint),
    getJupiterPrice(config.mint),
    getTickerSnapshot(quoteTracked.symbol),
    getCachedDepth(config.mint, 1),
  ]);
  const degraded: string[] = [];
  const token = info.status === "fulfilled" ? info.value : null;
  if (info.status === "rejected") degraded.push(`Token info: ${reason(info.reason, "Jupiter Tokens failed")}`);
  else if (!token) degraded.push("Jupiter has not indexed this token yet");
  const snapshot = quote.status === "fulfilled" ? quote.value : null;
  if (!snapshot) degraded.push(`${config.quoteSymbol}: ${reason(quote.status === "rejected" ? quote.reason : null, "reference unavailable")}`);

  const tokenUsd = (price.status === "fulfilled" ? price.value.price : null) ?? finite(token?.usdPrice);
  if (tokenUsd === null) degraded.push("No live price for the agent token yet");
  const quoteUsd = snapshot?.onchainPrice ?? null;
  const referenceUsd = snapshot?.referencePrice ?? null;
  // The pool is quoted in the stock, so the token's real unit is shares of it.
  const priceInQuote = tokenUsd !== null && quoteUsd !== null && quoteUsd > 0 ? tokenUsd / quoteUsd : null;
  const usdAtReference = priceInQuote !== null && referenceUsd !== null ? priceInQuote * referenceUsd : null;
  if (depth.status === "rejected") degraded.push(`Depth: ${reason(depth.reason, "Jupiter could not route a $100 buy")}`);

  const buyVolume = finite(token?.stats24h?.buyVolume);
  const sellVolume = finite(token?.stats24h?.sellVolume);
  const poolAddress = config.poolAddress ?? token?.firstPool?.id ?? null;

  return {
    token: {
      mint: config.mint,
      name: token?.name ?? null,
      symbol: token?.symbol ?? null,
      icon: token?.icon && /^https:\/\//.test(token.icon) ? token.icon : null,
      decimals: finite(token?.decimals),
    },
    quote: {
      symbol: quoteTracked.symbol,
      underlying: snapshot?.underlyingSymbol ?? null,
      mint: quoteMint,
      onchainPrice: quoteUsd,
      referencePrice: referenceUsd,
      referenceSource: snapshot?.source.reference ?? null,
      premiumPct: snapshot?.premiumPct ?? null,
      marketPeriod: snapshot?.market.period ?? null,
    },
    price: { usd: tokenUsd, inQuote: priceInQuote, usdAtReference },
    market: {
      liquidityUsd: finite(token?.liquidity),
      holders: finite(token?.holderCount),
      mcapUsd: finite(token?.mcap),
      volume24hUsd: buyVolume !== null || sellVolume !== null ? (buyVolume ?? 0) + (sellVolume ?? 0) : null,
      priceChange24hPct: finite(token?.stats24h?.priceChange),
      launchpad: typeof token?.launchpad === "string" ? token.launchpad : null,
      bondingCurvePct: finite(token?.bondingCurve),
      poolCreatedAt: token?.firstPool?.createdAt ?? null,
    },
    depth: {
      depth1PctUsd: depth.status === "fulfilled" ? depth.value.maxFillableUsd : null,
      route: depth.status === "fulfilled" ? depth.value.routeLabel : null,
    },
    pool: { address: poolAddress, explicit: config.poolAddress !== null },
    links: {
      solscan: `https://solscan.io/token/${config.mint}`,
      pool: poolAddress ? `https://solscan.io/account/${poolAddress}` : null,
      swap: `https://jup.ag/swap/${quoteMint}-${config.mint}`,
      clawpump: config.clawpumpUrl,
    },
    measuredAt: new Date().toISOString(),
    degraded: degraded.length > 0 ? degraded.join("; ") : null,
  };
}

export type AgentTokenReport = Awaited<ReturnType<typeof getAgentTokenReport>>;
