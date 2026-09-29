import "server-only";

import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithCustomSqrtPrices,
  CollectFeeMode,
  createSqrtPrices,
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  getPriceFromSqrtPrice,
  MigrationFeeOption,
  MigrationOption,
  Rounding,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  validateConfigParameters,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { getTickerSnapshot, resolveXStockMint, type TickerSnapshot } from "./market-data";
import { findTrackedAsset } from "./tracked-assets";

export const USDC_QUOTE = "USDC";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_DECIMALS = TokenDecimal.SIX;
const XSTOCK_DECIMALS = 8;
const USDC_DECIMALS = 6;
// Liquidity per segment: thin in the discount zone so early buyers close the
// gap to fair value quickly, dense inside the fair-value corridor so price
// settles there, moderate above it so graduation needs real demand.
const LIQUIDITY_WEIGHTS = [1, 6, 2] as const;
// Validation only needs a non-default key; the issuer's own wallet replaces it.
const PLACEHOLDER_RECEIVER = new PublicKey("SysvarRent111111111111111111111111111111111");
const CHART_STEPS_PER_SEGMENT = 16;
// Share-priced tokens have small supplies, so the SDK's rounding can leave a
// few base units over; they go to the leftover receiver (the issuer).
const LEFTOVER_SHARE = 0.001;

export interface DesignInput {
  base: { kind: "xstock"; symbol: string } | { kind: "custom"; name: string; fairUsd: number };
  quote: string;
  raiseUsd: number;
  startDiscountPct: number;
  corridorPct: number;
  graduationPremiumPct: number;
}

export function parseDesignInput(url: URL): DesignInput {
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(url.searchParams.get(key));
    return Number.isFinite(value) && url.searchParams.has(key) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const baseParam = url.searchParams.get("base") ?? "AMDx";
  const fairUsd = number("fair", 0, 0, 1e9);
  const base: DesignInput["base"] = baseParam === "custom" && fairUsd > 0
    ? { kind: "custom", name: (url.searchParams.get("name") ?? "Custom pair").slice(0, 40), fairUsd }
    : { kind: "xstock", symbol: findTrackedAsset(baseParam)?.symbol ?? "AMDx" };
  const quoteParam = url.searchParams.get("quote") ?? "TSLAx";
  const quote = quoteParam.toUpperCase() === USDC_QUOTE ? USDC_QUOTE : findTrackedAsset(quoteParam)?.symbol ?? "TSLAx";
  const corridorPct = number("corridor", 2, 0.5, 5);
  return {
    base,
    quote,
    raiseUsd: number("raise", 5_000, 500, 1_000_000),
    startDiscountPct: number("start", 15, Math.max(corridorPct + 1, 5), 40),
    corridorPct,
    graduationPremiumPct: number("grad", 5, corridorPct + 0.5, 20),
  };
}

interface LegPrice {
  symbol: string;
  mint: string;
  // What the real asset is worth (share price) and what the token trades at.
  referenceUsd: number;
  onchainUsd: number;
  premiumPct: number;
  referenceSource: string;
}

function legFromSnapshot(snapshot: TickerSnapshot): LegPrice {
  if (snapshot.referencePrice === null) {
    throw new Error(`${snapshot.symbol} has no reference price right now: ${snapshot.degraded.reason ?? "source unavailable"}`);
  }
  const onchain = snapshot.onchainPrice ?? snapshot.referencePrice;
  return {
    symbol: snapshot.symbol,
    mint: snapshot.mint,
    referenceUsd: snapshot.referencePrice,
    onchainUsd: onchain,
    premiumPct: snapshot.premiumPct ?? 0,
    referenceSource: snapshot.source.reference ?? "unknown",
  };
}

async function resolveQuote(symbol: string): Promise<LegPrice & { decimals: number }> {
  if (symbol === USDC_QUOTE) {
    return { symbol, mint: USDC_MINT, referenceUsd: 1, onchainUsd: 1, premiumPct: 0, referenceSource: "USD peg", decimals: USDC_DECIMALS };
  }
  const tracked = findTrackedAsset(symbol)!;
  const [snapshot, mint] = await Promise.all([
    getTickerSnapshot(tracked.symbol),
    tracked.mint ? Promise.resolve(tracked.mint) : resolveXStockMint(tracked.symbol),
  ]);
  return { ...legFromSnapshot(snapshot), mint, decimals: XSTOCK_DECIMALS };
}

// FairPrint's gate applied to the quote leg: a curve quoted in a mispriced
// xStock mis-prices every buy on it, so the launch waits for a fair quote.
function launchReadiness(quote: LegPrice) {
  const premium = Math.abs(quote.premiumPct);
  if (premium > 2) {
    return { gate: "overpay" as const, reason: `${quote.symbol} is ${quote.premiumPct.toFixed(2)}% from its share price. Launching now would open the curve off fair value for every buyer; wait until it is back under 0.5%.` };
  }
  if (premium >= 0.5) {
    return { gate: "caution" as const, reason: `${quote.symbol} is ${quote.premiumPct.toFixed(2)}% from its share price. Buyers paying in ${quote.symbol} would carry that gap; launching under 0.5% is safer.` };
  }
  return { gate: "fair" as const, reason: `${quote.symbol} trades within 0.5% of its share price, so the curve's anchor holds for buyers paying in it.` };
}

function toPlain(value: unknown): unknown {
  if (BN.isBN(value)) return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toPlain(entry)]));
  }
  return value;
}

function priceOf(sqrtPrice: BN, quoteDecimals: number) {
  return getPriceFromSqrtPrice(sqrtPrice, BASE_DECIMALS, quoteDecimals).toNumber();
}

export async function designStockCurve(input: DesignInput) {
  const quote = await resolveQuote(input.quote);
  const base = input.base.kind === "xstock"
    ? { ...legFromSnapshot(await getTickerSnapshot(input.base.symbol)), name: input.base.symbol }
    : { symbol: input.base.name, name: input.base.name, referenceUsd: input.base.fairUsd, referenceSource: "Issuer-supplied fair value" };

  // Both legs at their real share prices: the equity-relative fair price.
  const fairInQuote = base.referenceUsd / quote.referenceUsd;
  // What a naive launch anchored on the quote token's on-chain price would use.
  const naiveFairInQuote = base.referenceUsd / quote.onchainUsd;
  const anchorErrorPct = ((naiveFairInQuote - fairInQuote) / fairInQuote) * 100;

  const multipliers = [
    1 - input.startDiscountPct / 100,
    1 - input.corridorPct / 100,
    1 + input.corridorPct / 100,
    1 + input.graduationPremiumPct / 100,
  ];
  const ladderPrices = multipliers.map((multiplier) => fairInQuote * multiplier);
  const sqrtPrices = createSqrtPrices(ladderPrices, BASE_DECIMALS, quote.decimals);

  const build = (totalTokenSupply: number) => buildCurveWithCustomSqrtPrices({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: BASE_DECIMALS,
      tokenQuoteDecimal: quote.decimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply,
      leftover: totalTokenSupply * LEFTOVER_SHARE,
    },
    fee: {
      // Anti-snipe: 3% at open decaying to an equity-like 0.30% over the first hour.
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
        feeSchedulerParam: { startingFeeBps: 300, endingFeeBps: 30, numberOfPeriod: 12, totalDuration: 3_600 },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps25,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 0,
      partnerPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices,
    liquidityWeights: [...LIQUIDITY_WEIGHTS],
  });

  // The raise scales linearly with supply, so size supply from a probe build
  // to land the graduation threshold on the requested dollar raise.
  const raiseInQuote = input.raiseUsd / quote.onchainUsd;
  const probeSupply = 1_000_000;
  const probe = build(probeSupply);
  const probeThreshold = Number(probe.migrationQuoteThreshold.toString()) / 10 ** quote.decimals;
  const totalSupply = Math.max(1, Math.ceil((probeSupply * raiseInQuote) / probeThreshold));
  const config: ConfigParameters = build(totalSupply);

  let validation: { valid: true } | { valid: false; error: string };
  try {
    validateConfigParameters({ ...config, leftoverReceiver: PLACEHOLDER_RECEIVER });
    validation = { valid: true };
  } catch (error) {
    validation = { valid: false, error: error instanceof Error ? error.message : "Validation failed" };
  }

  // Walk the curve: cumulative quote paid and base sold at each ladder price,
  // plus finer points for the chart.
  const quoteScale = 10 ** quote.decimals;
  const baseScale = 10 ** BASE_DECIMALS;
  const ladder = [{ priceInQuote: priceOf(config.sqrtStartPrice, quote.decimals), quoteRaised: 0, baseSold: 0 }];
  const chart = [{ raisedUsd: 0, priceUsd: ladder[0].priceInQuote * quote.referenceUsd }];
  let lower = config.sqrtStartPrice;
  let quoteRaised = 0;
  let baseSold = 0;
  for (const point of config.curve) {
    const upper = point.sqrtPrice;
    for (let step = 1; step <= CHART_STEPS_PER_SEGMENT; step += 1) {
      const next = lower.add(upper.sub(lower).muln(step).divn(CHART_STEPS_PER_SEGMENT));
      const segmentQuote = Number(getDeltaAmountQuoteUnsigned(lower, next, point.liquidity, Rounding.Up).toString()) / quoteScale;
      chart.push({
        raisedUsd: (quoteRaised + segmentQuote) * quote.onchainUsd,
        priceUsd: priceOf(next, quote.decimals) * quote.referenceUsd,
      });
    }
    quoteRaised += Number(getDeltaAmountQuoteUnsigned(lower, upper, point.liquidity, Rounding.Up).toString()) / quoteScale;
    baseSold += Number(getDeltaAmountBaseUnsigned(lower, upper, point.liquidity, Rounding.Up).toString()) / baseScale;
    ladder.push({ priceInQuote: priceOf(upper, quote.decimals), quoteRaised, baseSold });
    lower = upper;
  }

  const labels = ["Opening price", "Corridor floor", "Corridor ceiling", "Graduation"];
  const thresholdInQuote = Number(config.migrationQuoteThreshold.toString()) / quoteScale;

  return {
    input,
    base: { symbol: base.symbol, name: base.name, fairUsd: base.referenceUsd, source: base.referenceSource },
    quote: {
      symbol: quote.symbol,
      mint: quote.mint,
      decimals: quote.decimals,
      referenceUsd: quote.referenceUsd,
      onchainUsd: quote.onchainUsd,
      premiumPct: quote.premiumPct,
      source: quote.referenceSource,
    },
    anchor: { fairInQuote, naiveFairInQuote, anchorErrorPct },
    readiness: launchReadiness(quote),
    ladder: ladder.map((row, index) => ({
      label: labels[index],
      multiplier: multipliers[index],
      priceInQuote: row.priceInQuote,
      priceUsd: row.priceInQuote * quote.referenceUsd,
      quoteRaised: row.quoteRaised,
      raisedUsd: row.quoteRaised * quote.onchainUsd,
      baseSold: row.baseSold,
    })),
    chart,
    weights: [...LIQUIDITY_WEIGHTS],
    totals: {
      totalSupply,
      leftover: totalSupply * LEFTOVER_SHARE,
      thresholdInQuote,
      thresholdUsd: thresholdInQuote * quote.onchainUsd,
      baseSoldOnCurve: baseSold,
      pctSoldOnCurve: (baseSold / totalSupply) * 100,
      corridorShareOfRaise: ((ladder[2].quoteRaised - ladder[1].quoteRaised) / quoteRaised) * 100,
    },
    fees: { startingBps: 300, endingBps: 30, periods: 12, durationSeconds: 3_600, dynamic: true, migratedPoolBps: 25 },
    validation,
    config: toPlain(config) as Record<string, unknown>,
    measuredAt: new Date().toISOString(),
  };
}

export type StockCurveDesign = Awaited<ReturnType<typeof designStockCurve>>;
