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
import type { RouteTrackRecord } from "@/lib/archive";
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
  comparisonDepth1PctUsd: number | null;
  trackRecord: RouteTrackRecord | null;
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

function CheapestRoute({ snapshot, trackRecord, comparisonDepth, tesseraDepth, notional }: {
  snapshot: TesseraSnapshot;
  trackRecord: RouteTrackRecord | null;
  comparisonDepth: number | null;
  tesseraDepth: number | null;
  notional: number;
}) {
  const { token, comparison } = snapshot;
  if (!comparison) {
    return (
      <section className="confidence-band" aria-labelledby="tessera-route-title">
        <div>
          <h2 id="tessera-route-title">Cheapest route to {token.company}</h2>
          <p>{token.symbol} is the only tokenized {token.company} exposure FairPrint tracks, so there is no other venue to compare.</p>
        </div>
      </section>
    );
  }

  const { prestocks, tesseraDiscountPct } = comparison;
  const tesseraCheaper = tesseraDiscountPct !== null && tesseraDiscountPct > 0;
  const cheaperDepth = tesseraCheaper ? tesseraDepth : comparisonDepth;
  const verdict = tesseraDiscountPct === null
    ? "A live price is missing on one side, so the two routes can't be compared right now."
    : Math.abs(tesseraDiscountPct) < 0.05
      ? `Both tokens price ${token.company} the same at live prices.`
      : tesseraCheaper
        ? `${token.symbol} is ${tesseraDiscountPct.toFixed(1)}% cheaper exposure to ${token.company} than PreStocks' ${prestocks.symbol}.`
        : `${token.symbol} is ${Math.abs(tesseraDiscountPct).toFixed(1)}% more expensive exposure to ${token.company} than PreStocks' ${prestocks.symbol}.`;
  const sizeCaveat = tesseraDiscountPct !== null && cheaperDepth !== null && cheaperDepth < notional
    ? ` At $${notional.toLocaleString("en-US")}, though, the cheaper route can only absorb about ${compactDollars(cheaperDepth)} before 1% price impact.`
    : "";

  return (
    <section className="cheapest-route" aria-labelledby="tessera-route-title" data-winner={tesseraCheaper ? "tessera" : "other"}>
      <h2 id="tessera-route-title">Cheapest route to {token.company}</h2>
      <p className="cheapest-route__verdict">{verdict}{sizeCaveat}</p>
      <p className="cheapest-route__track">
        {trackRecord && trackRecord.readings > 0
          ? `Over the last 7 days of archived minute readings (since ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(trackRecord.firstObservedAt))}), ${token.symbol} was the cheaper route in ${Math.round(trackRecord.pctTesseraCheaper)}% of ${trackRecord.readings.toLocaleString("en-US")} readings, ${trackRecord.discountMaxPct - trackRecord.discountMinPct < 0.1 ? `consistently ${trackRecord.discountMeanPct.toFixed(1)}%` : `ranging from ${trackRecord.discountMinPct.toFixed(1)}% to ${trackRecord.discountMaxPct.toFixed(1)}%`} below PreStocks.`
          : "The track record starts with the next archived minute reading."}
      </p>
      <div className="cheapest-route__venues">
        <div data-lead={tesseraCheaper}>
          <span>{token.symbol} · Tessera{tesseraCheaper ? " · cheaper route" : ""}</span>
          <strong>{compactValuation(snapshot.impliedValuation)}</strong>
          <small>
            {token.company} valuation implied by the live price{snapshot.onchainPrice !== null ? ` of $${snapshot.onchainPrice.toFixed(2)}` : ""}
            {" "}(Tessera marks it at {compactValuation(token.markValuation)}). Depth at 1%: {compactDollars(tesseraDepth)}.
          </small>
        </div>
        <div data-lead={tesseraDiscountPct !== null && !tesseraCheaper}>
          <span>{prestocks.symbol} · PreStocks{tesseraDiscountPct !== null && !tesseraCheaper ? " · cheaper route" : ""}</span>
          <strong>{compactValuation(prestocks.impliedValuation)}</strong>
          <small>
            {token.company} valuation implied by the live price{prestocks.livePrice !== null ? ` of $${prestocks.livePrice.toFixed(2)}` : ""}
            {" "}(PreStocks marks it at {compactValuation(prestocks.markValuation)}). Depth at 1%: {compactDollars(comparisonDepth)}.
          </small>
        </div>
      </div>
      <p className="cheapest-route__method">
        Each venue splits {token.company}{" "}
        into different-sized tokens, so token prices aren&apos;t comparable. FairPrint
        converts each live price into the company valuation it implies (live price ÷ mark price × mark valuation);
        the lower valuation is the cheaper way in. Prices: Jupiter Price v3
        {prestocks.priceSource === "PreStocks tokenPrice" ? `, with PreStocks' own tokenPrice for ${prestocks.symbol} because Jupiter had no price` : ""}.
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
  const discount = snapshot.comparison?.tesseraDiscountPct ?? null;

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

      <CheapestRoute
        snapshot={snapshot}
        trackRecord={data.trackRecord}
        comparisonDepth={data.comparisonDepth1PctUsd}
        tesseraDepth={depth.depth1PctUsd}
        notional={notional}
      />

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
          {decision.gate === "overpay" && discount !== null && discount > 0.05 && snapshot.comparison ? (
            <p>
              Measured against Tessera&apos;s own mark. It is still the cheapest on-chain route to {token.company}:{" "}
              {discount.toFixed(1)}% below PreStocks&apos; {snapshot.comparison.prestocks.symbol}.
            </p>
          ) : null}
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
              : discount !== null && discount > 0.05
                ? `Buy ${token.symbol} — ${discount.toFixed(1)}% cheaper ${token.company} exposure than PreStocks`
                : `Continue with ${token.symbol}`}
          </a>
        )}
      </div>
    </motion.section>
  );
}
