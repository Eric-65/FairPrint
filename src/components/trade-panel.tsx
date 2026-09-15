"use client";

import NumberFlow, {
  usePrefersReducedMotion,
  type NumberFlowProps,
} from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { decideExecutionGate } from "@/lib/gate";
import type { TickerSnapshot } from "@/lib/market-data";

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

interface DetailResponse {
  snapshot: TickerSnapshot;
  depth: DepthMeasurement;
  cost: CostMeasurement | null;
  costDegradedReason: string | null;
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
    `/api/market/${encodeURIComponent(symbol)}?${params}`,
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

function countdown(target: string | null, now: number) {
  if (!target) return "time unavailable";
  const remaining = Math.max(0, new Date(target).getTime() - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

function confidenceMultiplier(period: TickerSnapshot["market"]["period"]) {
  if (period === "market") return 1;
  if (period === "extended") return 2;
  if (period === "overnight") return 3;
  return 4;
}

function marketConfidenceCopy(period: TickerSnapshot["market"]["period"]) {
  if (period === "market") return "US market open, reference price is live.";
  if (period === "extended") return "US extended session, confidence band widened 2×.";
  if (period === "overnight") return "US overnight session, confidence band widened 3×.";
  return "US market closed, confidence band widened 4×.";
}

export function TradePanel({ symbol }: { symbol: string }) {
  const reduceMotion = usePrefersReducedMotion();
  const [notional, setNotional] = useState(1_000);
  const [tolerance, setTolerance] = useState(1);
  const [quotedInputs, setQuotedInputs] = useState({ notional: 1_000, tolerance: 1 });
  const [now, setNow] = useState(() => Date.now());
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [copyStatus, setCopyStatus] = useState("Copy mint");
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["trade-panel", symbol, quotedInputs.notional, quotedInputs.tolerance],
    queryFn: () => fetchDetail(symbol, quotedInputs.notional, quotedInputs.tolerance),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuotedInputs({
        notional: Math.min(100_000, Math.max(100, notional || 1_000)),
        tolerance: Math.min(5, Math.max(0.1, tolerance || 1)),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [notional, tolerance]);

  useEffect(() => {
    if (!data) return;
    document.documentElement.dataset.market = data.snapshot.market.open ? "open" : "closed";
  }, [data]);

  const decision = useMemo(
    () => decideExecutionGate({
      premiumPct: data?.snapshot.premiumPct ?? null,
      maxFillableUsd: data?.depth.depth1PctUsd ?? null,
      notionalUsd: notional,
      halted: data?.snapshot.market.halted ?? false,
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

  const { snapshot, depth, cost } = data;
  const referenceTimestamp = snapshot.freshness.referenceUpdatedAt ?? snapshot.freshness.pythPublishedAt;
  const jupiterUrl = `https://jup.ag/swap/USDC-${snapshot.mint}`;
  const confirmed = confirmation.trim().toUpperCase() === "OVERPAY";
  const bandMultiplier = confidenceMultiplier(snapshot.market.period);
  const baseConfidence = snapshot.referenceConfidence.absolute;
  const displayedConfidence = baseConfidence === null ? null : baseConfidence * bandMultiplier;
  const markerDistance =
    snapshot.onchainPrice !== null && snapshot.referencePrice !== null
      ? snapshot.onchainPrice - snapshot.referencePrice
      : null;
  const scaleDistance = displayedConfidence !== null && markerDistance !== null
    ? Math.max(displayedConfidence, Math.abs(markerDistance), 0.000001) * 1.2
    : null;
  const markerPosition = scaleDistance !== null && markerDistance !== null
    ? Math.min(100, Math.max(0, 50 + (markerDistance / scaleDistance) * 50))
    : null;
  const bandHalfWidth = scaleDistance !== null && displayedConfidence !== null
    ? Math.min(50, (displayedConfidence / scaleDistance) * 50)
    : null;
  const markerOutside = displayedConfidence !== null && markerDistance !== null
    ? Math.abs(markerDistance) > displayedConfidence
    : null;

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(snapshot.mint);
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
      aria-labelledby="trade-symbol"
    >
      <header className="trade-panel__status">
        <Link href="/#watchlist-title">Back to mispricing watch</Link>
        <span><i data-active={isFetching} />{isFetching ? "Remeasuring" : `${snapshot.market.exchange} ${snapshot.market.period}`}</span>
      </header>

      <div className="trade-verdict">
        <p id="trade-symbol">{snapshot.symbol} execution check</p>
        {snapshot.premiumPct === null ? (
          <strong className="trade-verdict__unavailable">Not measured</strong>
        ) : (
          <NumberFlow
            className="trade-verdict__number"
            value={snapshot.premiumPct}
            format={percentFormat}
            suffix="%"
            animated={!reduceMotion}
          />
        )}
        <h1>{snapshot.premiumPct !== null && snapshot.premiumPct >= 0 ? "Above" : "Below"} the stock reference</h1>
      </div>

      <div className="trade-raw-prices">
        <div>
          <span>On-chain last swap</span>
          {snapshot.onchainPrice === null ? <strong>Unavailable</strong> : <NumberFlow value={snapshot.onchainPrice} format={moneyFormat} animated={!reduceMotion} />}
          <small>Jupiter Price v3, block {snapshot.source.jupiterBlockId ?? "unavailable"}</small>
          <div className="mint-actions">
            <button type="button" onClick={() => void copyMint()} title={snapshot.mint}>
              {`${snapshot.mint.slice(0, 5)}…${snapshot.mint.slice(-5)}`} · {copyStatus}
            </button>
            <a href={`https://solscan.io/token/${snapshot.mint}`} target="_blank" rel="noreferrer">Verify on Solscan</a>
          </div>
        </div>
        <div>
          <span>{snapshot.underlyingSymbol} stock reference</span>
          {snapshot.referencePrice === null ? <strong>Unavailable</strong> : <NumberFlow value={snapshot.referencePrice} format={moneyFormat} animated={!reduceMotion} />}
          <small>
            {snapshot.source.reference ?? "Reference source unavailable"}. {referenceTimestamp
              ? `Reference is ${relativeAge(referenceTimestamp)} old.`
              : `Issuer quote fetched ${relativeAge(snapshot.freshness.fetchedAt)} ago.`}
          </small>
        </div>
      </div>

      <section className="confidence-band" aria-labelledby="confidence-title">
        <div>
          <h2 id="confidence-title">Reference confidence</h2>
          <p>
            {marketConfidenceCopy(snapshot.market.period)}{" "}
            {referenceTimestamp
              ? `Reference is ${relativeAge(referenceTimestamp)} old.`
              : "No source publish time is available."}
          </p>
        </div>
        {displayedConfidence !== null &&
        markerPosition !== null &&
        bandHalfWidth !== null &&
        snapshot.referencePrice !== null ? (
          <div className="confidence-scale" data-outside={markerOutside}>
            <div className="confidence-scale__track">
              <span
                className="confidence-scale__range"
                style={{ left: `${50 - bandHalfWidth}%`, width: `${bandHalfWidth * 2}%` }}
              />
              <span className="confidence-scale__reference" style={{ left: "50%" }} />
              <span className="confidence-scale__marker" style={{ left: `${markerPosition}%` }} />
            </div>
            <div className="confidence-scale__labels">
              <span>${(snapshot.referencePrice - displayedConfidence).toFixed(2)}</span>
              <strong>Reference ${snapshot.referencePrice.toFixed(2)}</strong>
              <span>${(snapshot.referencePrice + displayedConfidence).toFixed(2)}</span>
            </div>
            <p>
              Hermes ±${baseConfidence?.toFixed(4)}; displayed {bandMultiplier}× for {snapshot.market.period}.{" "}
              {markerOutside ? "The on-chain price is outside the confidence band." : "The on-chain price is inside the confidence band."}
            </p>
          </div>
        ) : (
          <p className="confidence-unavailable">Hermes confidence is unavailable, so FairPrint will not draw a guessed band.</p>
        )}
      </section>

      <div className="trade-measures">
        <div className="trade-size">
          <label htmlFor="trade-notional">Order size in US dollars</label>
          <span>$<input id="trade-notional" inputMode="decimal" min="100" max="100000" step="100" type="number" value={notional} onChange={(event) => setNotional(Math.max(0, Number(event.target.value) || 0))} /></span>
          <label className="tolerance-input" htmlFor="trade-tolerance">
            Slippage tolerance
            <input id="trade-tolerance" inputMode="decimal" min="0.1" max="5" step="0.1" type="number" value={tolerance} onChange={(event) => setTolerance(Math.max(0.1, Number(event.target.value) || 1))} />%
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
            <button type="button" popoverTarget={`cost-${snapshot.symbol}`}>Breakdown</button>
          </span>
          <strong>{cost ? signedDollars(cost.allInUsd) : "Unavailable"}</strong>
          <small>
            {cost
              ? `${cost.allInPct >= 0 ? "+" : ""}${cost.allInPct.toFixed(3)}% versus the stock reference`
              : data.costDegradedReason ?? "Entered-size quote unavailable"}
          </small>
          <div className="cost-popover" id={`cost-${snapshot.symbol}`} popover="auto">
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
                  <div><dt>Executable output at reference</dt><dd>{signedDollars(cost.executableOutputReferenceValue)}</dd></div>
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
        <p>This is economic exposure, not share ownership. There are no voting rights. Dividends compound into the token rather than paying cash. Redemption for the underlying share is restricted to qualified investors.</p>
      </aside>

      <div className="execution-gate" data-gate={decision.gate}>
        <div>
          <span>FairPrint gate</span>
          <strong>{decision.gate === "halted" ? "Halted" : decision.gate}</strong>
          <p>{decision.reason}</p>
        </div>

        {decision.gate === "halted" ? (
          <p className="gate-blocked">Execution is unavailable while the issuer reports this ticker halted.</p>
        ) : decision.gate === "overpay" ? (
          <div className="gate-actions">
            <button className="gate-primary" type="button" disabled>
              Wait for US market open · {countdown(snapshot.market.nextChangeAt, now)}
            </button>
            {!overrideOpen ? (
              <button className="gate-secondary" type="button" onClick={() => setOverrideOpen(true)}>Override this gate</button>
            ) : (
              <div className="gate-override">
                <label htmlFor="override-confirmation">Type OVERPAY to acknowledge the measured cost and depth risk.</label>
                <input id="override-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
                <a aria-disabled={!confirmed} href={confirmed ? jupiterUrl : undefined} target="_blank" rel="noreferrer">Continue to Jupiter</a>
              </div>
            )}
          </div>
        ) : decision.gate === "unavailable" ? (
          <button className="gate-primary" type="button" disabled>Swap unavailable until measurement recovers</button>
        ) : (
          <a className="gate-primary" href={jupiterUrl} target="_blank" rel="noreferrer">
            {decision.gate === "caution" && cost
              ? `Swap anyway — this costs about $${Math.abs(cost.allInUsd).toFixed(2)} versus the real stock`
              : `Continue with ${snapshot.symbol}`}
          </a>
        )}
      </div>
    </motion.section>
  );
}
