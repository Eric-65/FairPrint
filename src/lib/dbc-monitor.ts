import "server-only";

import { DynamicBondingCurveClient, getPriceFromSqrtPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import { getJupiterPrice, getTickerSnapshot, resolveXStockMint } from "./market-data";
import { findTrackedAsset, TRACKED_ASSETS } from "./tracked-assets";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Public DBC pools on mainnet whose quote token is a tokenized stock, so the
// monitor has something real to open. `ref` names the xStock whose share
// price is the base token's fair value, when one exists.
export const EXAMPLE_POOLS = [
  { address: "J1gcmbH3QthJahRdXqEAXc7eDbYE6JoWYqGVViGvFLbm", pair: "GME pair quoted in AAPLx", ref: "GMEx" },
  { address: "eMbF1jwsZ1YNBjcNmYK15FQrAyX8Hz4ksjtvvoSxZ25", pair: "DKNG pair quoted in AAPLx", ref: null },
  { address: "GretDMXwL3Na7AtVvQzaAuQhVw8zVwsttqVxkYKXE3FP", pair: "RDDT pair quoted in SOL", ref: null },
] as const;

export function isPoolAddress(value: string) {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

function rpcUrl() {
  const configured = process.env.SOLANA_RPC_URL?.trim();
  return configured && /^https:\/\//.test(configured) ? configured : "https://api.mainnet-beta.solana.com";
}

function amount(value: BN, decimals: number) {
  return Number(value.toString()) / 10 ** decimals;
}

interface QuoteLeg {
  symbol: string;
  onchainUsd: number | null;
  referenceUsd: number | null;
  premiumPct: number | null;
  source: string;
}

// The quote token's dollar value two ways: what it trades at, and — for a
// tokenized stock — what the underlying share is worth.
async function priceQuoteLeg(mint: string): Promise<QuoteLeg> {
  if (mint === USDC_MINT) return { symbol: "USDC", onchainUsd: 1, referenceUsd: 1, premiumPct: 0, source: "USD peg" };

  const knownMints = await Promise.all(
    TRACKED_ASSETS.map(async (asset) => ({
      symbol: asset.symbol,
      mint: asset.mint ?? await resolveXStockMint(asset.symbol).catch(() => null),
    })),
  );
  const xStock = knownMints.find((asset) => asset.mint === mint);
  if (xStock) {
    const snapshot = await getTickerSnapshot(xStock.symbol);
    return {
      symbol: xStock.symbol,
      onchainUsd: snapshot.onchainPrice,
      referenceUsd: snapshot.referencePrice,
      premiumPct: snapshot.premiumPct,
      source: snapshot.source.reference ?? "unavailable",
    };
  }

  const price = await getJupiterPrice(mint);
  return {
    symbol: mint === SOL_MINT ? "SOL" : `${mint.slice(0, 4)}…`,
    onchainUsd: price.price,
    referenceUsd: price.price,
    premiumPct: null,
    source: "Jupiter Price v3",
  };
}

export async function getDbcPoolReport(address: string, refSymbol: string | null) {
  const connection = new Connection(rpcUrl(), "confirmed");
  const client = new DynamicBondingCurveClient(connection, "confirmed");
  const pool = await client.state.getPool(address);
  if (!pool) return null;
  const state = pool.poolState;
  const config = await client.state.getPoolConfig(state.config);
  if (!config) throw new Error("The pool's config account could not be read");

  const quoteMint = config.quoteMint.toBase58();
  const [quoteSupply, quote, reference] = await Promise.all([
    connection.getTokenSupply(config.quoteMint),
    priceQuoteLeg(quoteMint),
    refSymbol && findTrackedAsset(refSymbol)
      ? getTickerSnapshot(findTrackedAsset(refSymbol)!.symbol).then(
          (snapshot) => ({ symbol: snapshot.symbol, fairUsd: snapshot.referencePrice }),
          () => null,
        )
      : Promise.resolve(null),
  ]);
  const baseDecimals = config.tokenDecimal;
  const quoteDecimals = quoteSupply.value.decimals;
  const price = (sqrtPrice: BN) => getPriceFromSqrtPrice(sqrtPrice, baseDecimals, quoteDecimals).toNumber();

  const priceInQuote = price(state.sqrtPrice);
  const quoteReserve = amount(state.quoteReserve, quoteDecimals);
  const threshold = amount(config.migrationQuoteThreshold, quoteDecimals);
  const migrated = state.isMigrated === 1;
  const priceUsdAtReference = quote.referenceUsd !== null ? priceInQuote * quote.referenceUsd : null;
  const basisPct = reference?.fairUsd && priceUsdAtReference !== null
    ? ((priceUsdAtReference - reference.fairUsd) / reference.fairUsd) * 100
    : null;

  return {
    address,
    baseMint: state.baseMint.toBase58(),
    quoteMint,
    config: state.config.toBase58(),
    creator: state.creator.toBase58(),
    quote: { ...quote, decimals: quoteDecimals },
    price: {
      inQuote: priceInQuote,
      usdAtMarket: quote.onchainUsd !== null ? priceInQuote * quote.onchainUsd : null,
      usdAtReference: priceUsdAtReference,
      start: price(config.sqrtStartPrice),
      graduation: price(config.migrationSqrtPrice),
    },
    reference: reference ? { ...reference, basisPct } : null,
    curve: config.curve
      .filter((point) => !point.liquidity.isZero())
      .map((point) => ({ priceInQuote: price(point.sqrtPrice), liquidity: point.liquidity.toString() })),
    progress: {
      quoteReserve,
      threshold,
      pct: migrated ? 100 : Math.min(100, threshold > 0 ? (quoteReserve / threshold) * 100 : 0),
      migrated,
      finishedAt: state.finishCurveTimestamp.isZero() ? null : new Date(Number(state.finishCurveTimestamp.toString()) * 1000).toISOString(),
    },
    fees: {
      totalTradingQuote: amount(state.metrics.totalTradingQuoteFee, quoteDecimals),
      unclaimedPartnerQuote: amount(state.partnerQuoteFee, quoteDecimals),
      unclaimedCreatorQuote: amount(state.creatorQuoteFee, quoteDecimals),
      collectedIn: config.collectFeeMode === 0 ? "quote" : "output",
    },
    supply: {
      preMigration: amount(config.preMigrationTokenSupply, baseDecimals),
      postMigration: amount(config.postMigrationTokenSupply, baseDecimals),
      baseReserve: amount(state.baseReserve, baseDecimals),
    },
    links: {
      pool: `https://solscan.io/account/${address}`,
      baseMint: `https://solscan.io/token/${state.baseMint.toBase58()}`,
      jupiter: `https://jup.ag/swap/${quoteMint}-${state.baseMint.toBase58()}`,
    },
    measuredAt: new Date().toISOString(),
  };
}

export type DbcPoolReport = NonNullable<Awaited<ReturnType<typeof getDbcPoolReport>>>;
