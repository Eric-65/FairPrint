"use client";

import NumberFlow, {
  usePrefersReducedMotion,
  type NumberFlowProps,
} from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect } from "react";
import type { TickerSnapshot } from "@/lib/market-data";
import type { WatchlistEntry, WatchlistResponse } from "@/lib/watchlist-types";

interface MarketError {
  error: string;
  action: string;
}

async function fetchWatchlist(): Promise<WatchlistResponse> {
  const response = await fetch("/api/market", { cache: "no-store" });
  if (!response.ok) {
    const failure = (await response.json()) as MarketError;
    throw new Error(`${failure.error}. ${failure.action}`);
  }
  return (await response.json()) as WatchlistResponse;
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

function relativeAge(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "less than a minute old";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} old`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} old`;
}

function referenceAge(snapshot: TickerSnapshot) {
  if (snapshot.freshness.referenceUpdatedAt) {
    return `Reference is ${relativeAge(snapshot.freshness.referenceUpdatedAt)}`;
  }
  if (snapshot.freshness.pythPublishedAt) {
    return `Pyth cross-check is ${relativeAge(snapshot.freshness.pythPublishedAt)}`;
  }
  return `Issuer reference is ${relativeAge(snapshot.freshness.fetchedAt)}`;
}

function compactDollars(value: number | null) {
  if (value === null) return "Not measured";
  if (value >= 100_000) return "$100k+";
  if (value >= 1_000) return `$${Math.floor(value / 100) / 10}k`;
  return `$${Math.floor(value).toLocaleString("en-US")}`;
}

function utcTimestamp(value: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function LoadingRows() {
  return (
    <div className="watch-rows" aria-label="Measuring twenty xStocks">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="watch-row watch-row--loading" key={index}>
          <span className="skeleton skeleton--symbol" />
          <span className="skeleton skeleton--number" />
          <span className="skeleton skeleton--number" />
          <span className="skeleton skeleton--number" />
        </div>
      ))}
    </div>
  );
}

function WorstGapInstrument({ entry, fetching }: { entry: WatchlistEntry; fetching: boolean }) {
  const reduceMotion = usePrefersReducedMotion();
  const snapshot = entry.snapshot;
  if (!snapshot) return null;
  const complete = snapshot.onchainPrice !== null && snapshot.referencePrice !== null;

  return (
    <motion.article
      className="ticker-instrument"
      data-state={entry.gate}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      aria-labelledby="headline-symbol"
    >
      <header className="instrument-head">
        <div>
          <span className="source-pulse" data-active={fetching} aria-hidden="true" />
          {fetching ? "Remeasuring" : "Largest live gap"}
        </div>
        <span>{referenceAge(snapshot)}</span>
      </header>

      <div className="ticker-row ticker-row--depth">
        <div className="ticker-identity">
          <h2 id="headline-symbol">{snapshot.symbol}</h2>
          <p>{snapshot.name}</p>
          <a className="instrument-link" href={`/t/${snapshot.symbol}`}>Open trade check</a>
        </div>
        <div className="measure-cell">
          <span className="measure-label">On-chain last swap</span>
          {snapshot.onchainPrice === null ? (
            <strong className="measure-unavailable">Unavailable</strong>
          ) : (
            <NumberFlow className="measure-number" value={snapshot.onchainPrice} format={moneyFormat} animated={!reduceMotion} />
          )}
          <small>Jupiter Price v3, block {snapshot.source.jupiterBlockId ?? "unavailable"}</small>
        </div>
        <div className="measure-cell">
          <span className="measure-label">{snapshot.underlyingSymbol} reference</span>
          {snapshot.referencePrice === null ? (
            <strong className="measure-unavailable">Unavailable</strong>
          ) : (
            <NumberFlow className="measure-number" value={snapshot.referencePrice} format={moneyFormat} animated={!reduceMotion} />
          )}
          <small>{snapshot.source.reference ?? "Reference unavailable"}; {referenceAge(snapshot)}</small>
        </div>
        <div className="measure-cell measure-cell--verdict">
          <span className="measure-label">Premium / discount</span>
          {snapshot.premiumPct === null ? (
            <strong className="measure-unavailable">Not measured</strong>
          ) : (
            <NumberFlow className="measure-number measure-number--premium" value={snapshot.premiumPct} format={percentFormat} suffix="%" animated={!reduceMotion} />
          )}
          <small className="verdict-label">{entry.gateReason}</small>
        </div>
        <div className="measure-cell measure-cell--depth">
          <span className="measure-label">Maximum size at 1% impact</span>
          <strong className="measure-number">{compactDollars(entry.depth.maxFillableUsd)}</strong>
          <small>{entry.depth.routeLabel ?? entry.depth.degradedReason ?? "Depth archive warming"}</small>
        </div>
      </div>

      {!complete && (
        <footer className="instrument-foot">
          <p className="degraded-note">Measurement withheld: {snapshot.degraded.reason ?? entry.error ?? "a required source is unavailable"}.</p>
        </footer>
      )}
    </motion.article>
  );
}

function WatchRow({ entry }: { entry: WatchlistEntry }) {
  const reduceMotion = usePrefersReducedMotion();
  const snapshot = entry.snapshot;
  const dangerousDepth = entry.depth.maxFillableUsd !== null && entry.depth.maxFillableUsd < 1_000;

  return (
    <a className="watch-row" data-state={entry.gate} href={`/t/${entry.symbol}`}>
      <span className="watch-row__signal" aria-hidden="true" />
      <span className="watch-row__identity">
        <strong>{entry.symbol}</strong>
        <small>{entry.liquidityClass === "thin" ? "Thin market" : "Core market"}</small>
      </span>
      <span className="watch-row__measure">
        <small>On-chain</small>
        {snapshot?.onchainPrice !== null && snapshot?.onchainPrice !== undefined ? (
          <NumberFlow value={snapshot.onchainPrice} format={moneyFormat} animated={!reduceMotion} />
        ) : <strong>—</strong>}
      </span>
      <span className="watch-row__measure">
        <small>Reference</small>
        {snapshot?.referencePrice !== null && snapshot?.referencePrice !== undefined ? (
          <NumberFlow value={snapshot.referencePrice} format={moneyFormat} animated={!reduceMotion} />
        ) : <strong>—</strong>}
      </span>
      <span className="watch-row__measure watch-row__premium">
        <small>Gap</small>
        {snapshot?.premiumPct !== null && snapshot?.premiumPct !== undefined ? (
          <NumberFlow value={snapshot.premiumPct} format={percentFormat} suffix="%" animated={!reduceMotion} />
        ) : <strong>Not measured</strong>}
      </span>
      <span className="watch-row__measure watch-row__depth">
        <small>Depth at 1%</small>
        <strong>{compactDollars(entry.depth.maxFillableUsd)}</strong>
        {dangerousDepth && <em>Size danger</em>}
      </span>
      <span className="watch-row__status">
        <small>{snapshot ? referenceAge(snapshot) : entry.error ?? "Source failed"}</small>
      </span>
    </a>
  );
}

export function Watchlist() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
    refetchInterval: 15_000,
  });

  const marketOpen = data?.entries.find((entry) => entry.snapshot)?.snapshot?.market.open;
  useEffect(() => {
    if (marketOpen === undefined) return;
    document.documentElement.dataset.market = marketOpen ? "open" : "closed";
  }, [marketOpen]);

  if (isPending) return <LoadingRows />;
  if (error || !data) {
    return (
      <div className="source-failure" role="status">
        <div>
          <strong>Watchlist measurement interrupted</strong>
          <p>{error instanceof Error ? error.message : "Every live source is unavailable."} Retrying in 15 seconds.</p>
        </div>
        <button type="button" onClick={() => void refetch()}>Measure again</button>
      </div>
    );
  }

  const measurable = data.entries.filter((entry) => entry.snapshot?.premiumPct !== null);
  if (measurable.length === 0) {
    return (
      <div className="source-failure" role="status">
        <div>
          <strong>No reproducible premiums right now</strong>
          <p>Required reference or on-chain sources failed for all 20 symbols. Retrying in {data.retryAfterSeconds} seconds.</p>
        </div>
        <button type="button" onClick={() => void refetch()}>Measure again</button>
      </div>
    );
  }

  const headline = measurable[0];

  return (
    <div>
      {data.widestGap24h ? (
        <a className="archive-strip" href={`/t/${data.widestGap24h.symbol}`}>
          <span>Widest gap observed in the last 24h</span>
          <strong>{data.widestGap24h.symbol}</strong>
          <span>{data.widestGap24h.premiumPct >= 0 ? "+" : ""}{data.widestGap24h.premiumPct.toFixed(2)}%</span>
          <small>at {utcTimestamp(data.widestGap24h.observedAt)} UTC</small>
        </a>
      ) : (
        <div className="archive-strip archive-strip--empty">
          {data.archiveDegradedReason ?? "Archive is warming. The first widest-gap record will appear after ingestion."}
        </div>
      )}

      <WorstGapInstrument entry={headline} fetching={isFetching} />

      <div className="watch-table-head" aria-hidden="true">
        <span>Tracked xStock</span><span>On-chain</span><span>Reference</span><span>Gap</span><span>Depth</span>
      </div>
      <div className="watch-rows">
        {data.entries.map((entry) => <WatchRow entry={entry} key={entry.symbol} />)}
      </div>
      <p className="watchlist-note">Sorted by absolute premium. Depth is the latest archived Jupiter binary search and refreshes independently every 60 seconds.</p>
    </div>
  );
}
