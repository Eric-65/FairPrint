"use client";

import NumberFlow, {
  usePrefersReducedMotion,
  type NumberFlowProps,
} from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PremiumHistory } from "@/components/premium-history";
import { decideExecutionGate } from "@/lib/gate";
import type { PreStocksAsset } from "@/lib/prestocks";

interface DepthMeasurement {
  routeLabel: string | null;
  poolTvlUsd: number | null;
  poolVolume24hUsd: number | null;
  depth1PctUsd: number | null;
  priceImpactAt1kPct: number | null;
  probes: number;
  degradedReasons: string[];
  source: "live" | "archive";
  observedAt: string;
}

interface CostMeasurement {
  notionalUsd: number;
  premiumPct: number;
  priceImpactPct: number;
  ammFeePct: number | null;
  ammFeeUsd: number | null;
  feesItemized: boolean;
  networkFeeUsd: number;
  allInPct: number;
  allInUsd: number;
  executableOutput: number;
  executableOutputReferenceValue: number | null;
  computation: string;
  routeLabel: string;
  contextSlot: number | null;
  quotedAt: string;
}

interface CrossCheck {
  jupiterPrice: number | null;
  tokenPrice: number | null;
  divergencePct: number | null;
  flagged: boolean;
  error: string | null;
}

interface DetailResponse {
  asset: PreStocksAsset;
  depth: DepthMeasurement;
  cost: CostMeasurement | null;
  costDegradedReason: string | null;
  crossCheck: CrossCheck;
  notionalUsd: number;
  tolerancePct: number;
  measuredAt: string;
}

interface ApiError {
  error: string;
  action: string;
  detail?: string;
}

const moneyFormat: NonNullable<NumberFlowProps["format"]> = {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const percentFormat: NonNullable<NumberFlowProps["format"]> = {
  signDisplay: "always",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

async function fetchDetail(
  symbol: string,
  notionalUsd: number,
  tolerancePct: number,
): Promise<DetailResponse> {
  const params = new URLSearchParams({
    notional: String(notionalUsd),
    slippage: String(tolerancePct),
  });
  const response = await fetch(
    `/api/prestocks/${encodeURIComponent(symbol)}?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const failure = (await response.json()) as ApiError;
    throw new Error(`${failure.error}. ${failure.action}${failure.detail ? ` ${failure.detail}` : ""}`);
  }
  return (await response.json()) as DetailResponse;
}

function relativeAge(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function compactDollars(value: number | null) {
  if (value === null) return "Unavailable";
  if (value >= 100_000) return "$100,000+";
  return `$${Math.floor(value).toLocaleString("en-US")}`;
}

function signedDollars(value: number) {
  const absolute = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "−" : ""}$${absolute}`;
}

export function PreStocksPanel({ symbol }: { symbol: string }) {
  const reduceMotion = usePrefersReducedMotion();
  const [notional, setNotional] = useState(1_000);
  const [tolerance, setTolerance] = useState(1);
  const [quotedInputs, setQuotedInputs] = useState({ notional: 1_000, tolerance: 1 });
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [copyStatus, setCopyStatus] = useState("Copy mint");
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["prestocks-panel", symbol, quotedInputs.notional, quotedInputs.tolerance],
    queryFn: () => fetchDetail(symbol, quotedInputs.notional, quotedInputs.tolerance),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuotedInputs({
        notional: Math.min(100_000, Math.max(100, notional || 1_000)),
        tolerance: Math.min(5, Math.max(0.1, tolerance || 1)),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [notional, tolerance]);

  const decision = useMemo(
    () => decideExecutionGate({
      premiumPct: data?.asset.premiumPct ?? null,
      maxFillableUsd: data?.depth.depth1PctUsd ?? null,
      notionalUsd: notional,
      halted: false,
    }),
    [data, notional],
  );

  if (isPending) {
    return <div className="trade-panel-loading"><span className="skeleton skeleton--number" /><span>Measuring price and executable depth</span></div>;
  }

  if (error || !data) {
    return (
      <div className="source-failure" role="status">
        <div><strong>Trade measurement interrupted</strong><p>{error instanceof Error ? error.message : "Required sources did not return data."} Retrying in 15 seconds.</p></div>
        <button type="button" onClick={() => void refetch()}>Measure again</button>
      </div>
    );
  }

  const { asset, depth, cost, crossCheck } = data;
  const jupiterUrl = `https://jup.ag/swap/USDC-${asset.mint}`;
  const confirmed = confirmation.trim().toUpperCase() === "OVERPAY";

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(asset.mint);
      setCopyStatus("Mint copied");
      window.setTimeout(() => setCopyStatus("Copy mint"), 1_800);
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  return (
    <motion.section
      className="trade-panel"
      data-state={decision.gate}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      aria-labelledby="prestocks-trade-symbol"
    >
      <header className="trade-panel__status">
        <Link href="/prestocks">Back to PreStocks watch</Link>
        <span><i data-active={isFetching} />{isFetching ? "Remeasuring" : "PreStocks · private company, no market hours"}</span>
      </header>

      <div className="trade-verdict">
        <p id="prestocks-trade-symbol">{asset.symbol} execution check</p>
        {asset.premiumPct === null ? (
          <strong className="trade-verdict__unavailable">Not measured</strong>
        ) : (
          <NumberFlow
            className="trade-verdict__number"
            value={asset.premiumPct}
            format={percentFormat}
            suffix="%"
            animated={!reduceMotion}
          />
        )}
        <h1>{asset.premiumPct !== null && asset.premiumPct >= 0 ? "Above" : "Below"} the PreStocks mark</h1>
      </div>

      <div className="trade-raw-prices">
        <div>
          <span>Token price</span>
          {asset.tokenPrice === null ? <strong>Unavailable</strong> : <NumberFlow value={asset.tokenPrice} format={moneyFormat} animated={!reduceMotion} />}
          <small>The token&apos;s actual price, as reported by PreStocks</small>
          <div className="mint-actions">
            <button type="button" onClick={() => void copyMint()} title={asset.mint}>
              {`${asset.mint.slice(0, 5)}…${asset.mint.slice(-5)}`} · {copyStatus}
            </button>
            <a href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer">Verify on Solscan</a>
          </div>
        </div>
        <div>
          <span>PreStocks mark</span>
          {asset.markPrice === null ? <strong>Unavailable</strong> : <NumberFlow value={asset.markPrice} format={moneyFormat} animated={!reduceMotion} />}
          <small>PreStocks&apos; own fundamental valuation mark for {asset.name}</small>
        </div>
      </div>

      <PremiumHistory symbol={asset.symbol} />

      <section className="confidence-band" aria-labelledby="prestocks-basis-title">
        <div>
          <h2 id="prestocks-basis-title">Reference basis</h2>
          <p>
            PreStocks mark as of {relativeAge(asset.fetchedAt)} ago. PreStocks publishes no confidence
            interval, so FairPrint will not draw a guessed band.
          </p>
        </div>
      </section>

      <section className="confidence-band" aria-labelledby="prestocks-crosscheck-title">
        <div>
          <h2 id="prestocks-crosscheck-title">Cross-check against live on-chain price</h2>
          {crossCheck.jupiterPrice === null ? (
            <p className="confidence-unavailable">
              {crossCheck.error ?? "Jupiter Price v3 did not return a price for this mint."}
            </p>
          ) : (
            <p className={crossCheck.flagged ? "degraded-note" : undefined}>
              PreStocks reports {asset.tokenPrice !== null ? `$${asset.tokenPrice.toFixed(4)}` : "no price"}, live
              on-chain shows ${crossCheck.jupiterPrice.toFixed(4)}
              {crossCheck.divergencePct !== null ? ` (${crossCheck.divergencePct.toFixed(2)}% apart)` : ""}.{" "}
              {crossCheck.flagged
                ? "This is a larger gap than expected between PreStocks' own reported price and live on-chain data."
                : "These are in line with each other."}
            </p>
          )}
        </div>
      </section>

      <div className="trade-measures">
        <div className="trade-size">
          <label htmlFor="prestocks-trade-notional">Order size in US dollars</label>
          <span>$<input id="prestocks-trade-notional" inputMode="decimal" min="100" max="100000" step="100" type="number" value={notional} onChange={(event) => setNotional(Math.max(0, Number(event.target.value) || 0))} /></span>
          <label className="tolerance-input" htmlFor="prestocks-trade-tolerance">
            Slippage tolerance
            <input id="prestocks-trade-tolerance" inputMode="decimal" min="0.1" max="5" step="0.1" type="number" value={tolerance} onChange={(event) => setTolerance(Math.max(0.1, Number(event.target.value) || 1))} />%
          </label>
        </div>
        <div>
          <span>Maximum fill before {data.tolerancePct}% impact</span>
          <strong>{compactDollars(depth.depth1PctUsd)}</strong>
          <small>
            {depth.source === "live"
              ? `${depth.probes} live Jupiter probes via ${depth.routeLabel ?? "no route"}`
              : `Archived Jupiter binary search from ${relativeAge(depth.observedAt)} ago via ${depth.routeLabel ?? "no route"}`}
          </small>
        </div>
        <div className="cost-measure">
          <span>
            All-in cost at size
            <button type="button" popoverTarget={`prestocks-cost-${asset.symbol}`}>Breakdown</button>
          </span>
          <strong>{cost ? signedDollars(cost.allInUsd) : "Unavailable"}</strong>
          <small>
            {cost
              ? `${cost.allInPct >= 0 ? "+" : ""}${cost.allInPct.toFixed(3)}% versus the PreStocks mark`
              : data.costDegradedReason ?? "Entered-size quote unavailable"}
          </small>
          <div className="cost-popover" id={`prestocks-cost-${asset.symbol}`} popover="auto">
            <strong>All-in cost breakdown</strong>
            {cost ? (
              <dl>
                <div><dt>Premium / discount</dt><dd>{cost.premiumPct >= 0 ? "+" : ""}{cost.premiumPct.toFixed(4)}%</dd></div>
                <div><dt>Price impact</dt><dd>+{cost.priceImpactPct.toFixed(4)}%</dd></div>
                <div>
                  <dt>AMM route fees</dt>
                  <dd>{cost.ammFeePct !== null && cost.ammFeeUsd !== null
                    ? `+${cost.ammFeePct.toFixed(4)}% (${signedDollars(cost.ammFeeUsd)})`
                    : "Included in output; not itemized"}</dd>
                </div>
                <div><dt>Network fee estimate</dt><dd>{signedDollars(cost.networkFeeUsd)}</dd></div>
                {cost.executableOutputReferenceValue !== null && (
                  <div><dt>Executable output at mark</dt><dd>{signedDollars(cost.executableOutputReferenceValue)}</dd></div>
                )}
                <div><dt>Total at ${cost.notionalUsd.toLocaleString("en-US")}</dt><dd>{signedDollars(cost.allInUsd)}</dd></div>
              </dl>
            ) : <p>{data.costDegradedReason ?? "The quote did not return every required cost input."}</p>}
            <small>
              Formula: {cost?.computation ?? "unavailable"}. Route: {cost?.routeLabel ?? "unavailable"}.
              {data.costDegradedReason ? ` ${data.costDegradedReason}` : ""}
            </small>
          </div>
        </div>
      </div>

      <p className="depth-sentence">
        {depth.depth1PctUsd === null
          ? `Depth could not be measured: ${depth.degradedReasons.join("; ") || "Jupiter returned no route"}.`
          : `You can fill up to ${compactDollars(depth.depth1PctUsd)} before price impact passes ${data.tolerancePct}%.`}
      </p>

      <div className="pool-context">
        <span>Meteora DLMM context</span>
        <strong>TVL {depth.poolTvlUsd === null ? "unavailable" : `$${Math.round(depth.poolTvlUsd).toLocaleString("en-US")}`}</strong>
        <strong>24h volume {depth.poolVolume24hUsd === null ? "unavailable" : `$${Math.round(depth.poolVolume24hUsd).toLocaleString("en-US")}`}</strong>
      </div>

      <aside className="rights-panel">
        <h2>What you actually own</h2>
        <p>
          This is SPV exposure tracking {asset.name}&apos;s price, not direct equity in the company.
          There are no voting rights. Liquidity depends entirely on this token&apos;s own secondary
          market, which can be thin or absent.
        </p>
      </aside>

      <div className="execution-gate" data-gate={decision.gate}>
        <div>
          <span>FairPrint gate</span>
          <strong>{decision.gate}</strong>
          <p>{decision.reason}</p>
        </div>

        {decision.gate === "overpay" ? (
          <div className="gate-actions">
            <button className="gate-primary" type="button" disabled>
              Re-check before trading — this mark may have moved
            </button>
            {!overrideOpen ? (
              <button className="gate-secondary" type="button" onClick={() => setOverrideOpen(true)}>Override this gate</button>
            ) : (
              <div className="gate-override">
                <label htmlFor="prestocks-override-confirmation">Type OVERPAY to acknowledge the measured cost and depth risk.</label>
                <input id="prestocks-override-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
                <a aria-disabled={!confirmed} href={confirmed ? jupiterUrl : undefined} target="_blank" rel="noreferrer">Continue to Jupiter</a>
              </div>
            )}
          </div>
        ) : decision.gate === "unavailable" ? (
          <button className="gate-primary" type="button" disabled>Swap unavailable until measurement recovers</button>
        ) : (
          <a className="gate-primary" href={jupiterUrl} target="_blank" rel="noreferrer">
            {decision.gate === "caution" && cost
              ? `Swap anyway — this costs about $${Math.abs(cost.allInUsd).toFixed(2)} versus the PreStocks mark`
              : `Continue with ${asset.symbol}`}
          </a>
        )}
      </div>
    </motion.section>
  );
}
