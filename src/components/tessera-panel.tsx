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
import type { TesseraSnapshot } from "@/lib/tessera";

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
  snapshot: TesseraSnapshot;
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

async function fetchDetail(symbol: string, notionalUsd: number, tolerancePct: number): Promise<DetailResponse> {
  const params = new URLSearchParams({ notional: String(notionalUsd), slippage: String(tolerancePct) });
  const response = await fetch(`/api/tessera/${encodeURIComponent(symbol)}?${params}`, { cache: "no-store" });
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

export function compactValuation(value: number | null) {
  if (value === null) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(value >= 1e11 ? 0 : 1)}B`;
  return `$${Math.round(value / 1e6).toLocaleString("en-US")}M`;
}

function signedDollars(value: number) {
  const absolute = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "−" : ""}$${absolute}`;
}

function ImpliedValuation({ snapshot, depth, notional }: {
  snapshot: TesseraSnapshot;
  depth: number | null;
  notional: number;
}) {
  const { token, premiumPct } = snapshot;
  const verdict = premiumPct === null || snapshot.impliedValuation === null
    ? `A live price or Tessera mark is missing, so the market-implied ${token.company} valuation can't be measured right now.`
    : Math.abs(premiumPct) < 0.05
      ? `At the live price, ${token.symbol} values ${token.company} right at Tessera's own valuation.`
      : `At the live price, ${token.symbol} values ${token.company} ${Math.abs(premiumPct).toFixed(1)}% ${premiumPct < 0 ? "below" : "above"} Tessera's own valuation.`;
  const sizeCaveat = depth !== null && depth < notional
    ? ` At $${notional.toLocaleString("en-US")}, though, the pools can only absorb about ${compactDollars(depth)} before 1% price impact.`
    : "";

  return (
    <section className="implied-value" aria-labelledby="tessera-value-title">
      <h2 id="tessera-value-title">What the market pays for {token.company}</h2>
      <p className="implied-value__verdict">{verdict}{sizeCaveat}</p>
      <div className="implied-value__venues">
        <div data-lead="true">
          <span>Market-implied · {token.symbol}</span>
          <strong>{compactValuation(snapshot.impliedValuation)}</strong>
          <small>
            {token.company} valuation implied by the live price{snapshot.onchainPrice !== null ? ` of $${snapshot.onchainPrice.toFixed(2)}` : ""}.
            {" "}Depth at 1%: {compactDollars(depth)}.
          </small>
        </div>
        <div>
          <span>Tessera valuation</span>
          <strong>{compactValuation(token.markValuation)}</strong>
          <small>
            Tessera&apos;s own {token.company} valuation, behind its mark price
            {token.markPrice !== null ? ` of $${token.markPrice.toFixed(2)}` : ""}.
          </small>
        </div>
      </div>
      <p className="implied-value__method">
        Market-implied valuation = live price ÷ mark price × Tessera&apos;s valuation, so the gap between the two
        figures is the same premium or discount shown below, expressed in company terms. Prices: Jupiter Price v3.
      </p>
    </section>
  );
}

export function TesseraPanel({ symbol }: { symbol: string }) {
  const reduceMotion = usePrefersReducedMotion();
  const [notional, setNotional] = useState(1_000);
  const [tolerance, setTolerance] = useState(1);
  const [quotedInputs, setQuotedInputs] = useState({ notional: 1_000, tolerance: 1 });
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [copyStatus, setCopyStatus] = useState("Copy mint");
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["tessera-panel", symbol, quotedInputs.notional, quotedInputs.tolerance],
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
      premiumPct: data?.snapshot.premiumPct ?? null,
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

  const { snapshot, depth, cost } = data;
  const { token } = snapshot;
  const jupiterUrl = `https://jup.ag/swap/USDC-${token.mint}`;
  const confirmed = confirmation.trim().toUpperCase() === "OVERPAY";

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(token.mint);
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
      aria-labelledby="tessera-trade-symbol"
    >
      <header className="trade-panel__status">
        <Link href="/tessera">Back to Tessera watch</Link>
        <span><i data-active={isFetching} />{isFetching ? "Remeasuring" : "Tessera · private company, no market hours"}</span>
      </header>

      <ImpliedValuation snapshot={snapshot} depth={depth.depth1PctUsd} notional={notional} />

      <div className="trade-verdict">
        <p id="tessera-trade-symbol">{token.symbol} execution check</p>
        {snapshot.premiumPct === null ? (
          <strong className="trade-verdict__unavailable">Not measured</strong>
        ) : (
          <NumberFlow className="trade-verdict__number" value={snapshot.premiumPct} format={percentFormat} suffix="%" animated={!reduceMotion} />
        )}
        <h1>{snapshot.premiumPct !== null && snapshot.premiumPct >= 0 ? "Above" : "Below"} the Tessera mark</h1>
      </div>

      <div className="trade-raw-prices">
        <div>
          <span>Live on-chain price</span>
          {snapshot.onchainPrice === null ? <strong>Unavailable</strong> : <NumberFlow value={snapshot.onchainPrice} format={moneyFormat} animated={!reduceMotion} />}
          <small>Jupiter Price v3, block {snapshot.jupiterBlockId ?? "unavailable"}</small>
          <div className="mint-actions">
            <button type="button" onClick={() => void copyMint()} title={token.mint}>
              {`${token.mint.slice(0, 5)}…${token.mint.slice(-5)}`} · {copyStatus}
            </button>
            <a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noreferrer">Verify on Solscan</a>
          </div>
        </div>
        <div>
          <span>Tessera mark</span>
          {token.markPrice === null ? <strong>Unavailable</strong> : <NumberFlow value={token.markPrice} format={moneyFormat} animated={!reduceMotion} />}
          <small>
            Tessera values {token.company} at {compactValuation(token.markValuation)}
            {token.holders !== null ? ` · ${token.holders.toLocaleString("en-US")} holders` : ""}
            {token.sector ? ` · ${token.sector}` : ""}
          </small>
        </div>
      </div>

      <PremiumHistory venue="tessera" symbol={token.symbol} markLabel="Tessera mark" />

      <section className="confidence-band" aria-labelledby="tessera-basis-title">
        <div>
          <h2 id="tessera-basis-title">Reference basis</h2>
          <p>
            Tessera mark as of {relativeAge(token.fetchedAt)} ago. Tessera publishes no confidence interval or
            timestamp for its mark, so FairPrint shows its own fetch time and will not draw a guessed band.
          </p>
        </div>
      </section>

      <div className="trade-measures">
        <div className="trade-size">
          <label htmlFor="tessera-trade-notional">Order size in US dollars</label>
          <span>$<input id="tessera-trade-notional" inputMode="decimal" min="100" max="100000" step="100" type="number" value={notional} onChange={(event) => setNotional(Math.max(0, Number(event.target.value) || 0))} /></span>
          <label className="tolerance-input" htmlFor="tessera-trade-tolerance">
            Slippage tolerance
            <input id="tessera-trade-tolerance" inputMode="decimal" min="0.1" max="5" step="0.1" type="number" value={tolerance} onChange={(event) => setTolerance(Math.max(0.1, Number(event.target.value) || 1))} />%
          </label>
        </div>
        <div>
          <span>Maximum fill before {data.tolerancePct}% impact</span>
          <strong>{compactDollars(depth.depth1PctUsd)}</strong>
          <small>
            {depth.source === "live"
              ? `${depth.probes} live Jupiter probes via ${depth.routeLabel ?? "no route"}`
              : `Archived Jupiter search from ${relativeAge(depth.observedAt)} ago via ${depth.routeLabel ?? "no route"}`}
          </small>
        </div>
        <div className="cost-measure">
          <span>
            All-in cost at size
            <button type="button" popoverTarget={`tessera-cost-${token.symbol}`}>Breakdown</button>
          </span>
          <strong>{cost ? signedDollars(cost.allInUsd) : "Unavailable"}</strong>
          <small>
            {cost
              ? `${cost.allInPct >= 0 ? "+" : ""}${cost.allInPct.toFixed(3)}% versus the Tessera mark`
              : data.costDegradedReason ?? "Entered-size quote unavailable"}
          </small>
          <div className="cost-popover" id={`tessera-cost-${token.symbol}`} popover="auto">
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
          T-Tokens are loan participation rights tracking {token.company}&apos;s value, not shares or other securities,
          and carry no voting rights. Redemption and settlement follow Tessera&apos;s{" "}
          <a href="https://terms.tessera.pe" target="_blank" rel="noreferrer">terms and conditions</a>. Tessera states the
          backing is auditable through Chainlink Proof of Reserves with custody at Fireblocks; FairPrint does not verify
          that independently. Liquidity depends on this token&apos;s Solana DEX pools, which can be thin.
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
                <label htmlFor="tessera-override-confirmation">Type OVERPAY to acknowledge the measured cost and depth risk.</label>
                <input id="tessera-override-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
                <a aria-disabled={!confirmed} href={confirmed ? jupiterUrl : undefined} target="_blank" rel="noreferrer">Continue to Jupiter</a>
              </div>
            )}
          </div>
        ) : decision.gate === "unavailable" ? (
          <button className="gate-primary" type="button" disabled>Swap unavailable until measurement recovers</button>
        ) : (
          <a className="gate-primary" href={jupiterUrl} target="_blank" rel="noreferrer">
            {decision.gate === "caution" && cost
              ? `Swap anyway — this costs about $${Math.abs(cost.allInUsd).toFixed(2)} versus the Tessera mark`
              : `Continue with ${token.symbol}`}
          </a>
        )}
      </div>
    </motion.section>
  );
}
