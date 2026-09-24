"use client";

import NumberFlow, {
  usePrefersReducedMotion,
  type NumberFlowProps,
} from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { compactValuation } from "@/components/tessera-panel";
import type { TesseraSnapshot } from "@/lib/tessera";
import type { TesseraWatchlistEntry, TesseraWatchlistResponse } from "@/lib/tessera-types";

async function fetchTesseraWatchlist(): Promise<TesseraWatchlistResponse> {
  const response = await fetch("/api/tessera", { cache: "no-store" });
  if (!response.ok) {
    const failure = (await response.json()) as { error: string; action: string };
    throw new Error(`${failure.error}. ${failure.action}`);
  }
  return (await response.json()) as TesseraWatchlistResponse;
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

function compactDollars(value: number | null) {
  if (value === null) return "Not measured";
  if (value >= 100_000) return "$100k+";
  if (value >= 1_000) return `$${Math.floor(value / 100) / 10}k`;
  return `$${Math.floor(value).toLocaleString("en-US")}`;
}

function routeSummary(snapshot: TesseraSnapshot) {
  const comparison = snapshot.comparison;
  if (!comparison) return `Only tokenized ${snapshot.token.company} route tracked`;
  const discount = comparison.tesseraDiscountPct;
  if (discount === null) return `vs PreStocks ${comparison.prestocks.symbol}: price missing`;
  if (Math.abs(discount) < 0.05) return `Same price as PreStocks ${comparison.prestocks.symbol}`;
  return discount > 0
    ? `${discount.toFixed(1)}% cheaper than PreStocks ${comparison.prestocks.symbol}`
    : `${Math.abs(discount).toFixed(1)}% pricier than PreStocks ${comparison.prestocks.symbol}`;
}

function LoadingRows() {
  return (
    <div className="watch-rows" aria-label="Measuring Tessera T-Tokens">
      {Array.from({ length: 3 }, (_, index) => (
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

function HeadlineInstrument({ entry, fetching }: { entry: TesseraWatchlistEntry; fetching: boolean }) {
  const reduceMotion = usePrefersReducedMotion();
  const { snapshot } = entry;
  const { token } = snapshot;
  const href = `/tessera/${encodeURIComponent(token.symbol)}`;

  return (
    <motion.article
      className="ticker-instrument"
      data-state={entry.gate}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      aria-labelledby="tessera-headline-symbol"
    >
      <header className="instrument-head">
        <div>
          <span className="source-pulse" data-active={fetching} aria-hidden="true" />
          {fetching ? "Remeasuring" : "Largest live gap"}
        </div>
        <span>{token.holders !== null ? `${token.holders.toLocaleString("en-US")} holders` : token.sector ?? ""}</span>
      </header>

      <div className="ticker-row ticker-row--depth">
        <div className="ticker-identity">
          <h2 id="tessera-headline-symbol">{token.symbol}</h2>
          <p>{token.company} · Tessera marks it at {compactValuation(token.markValuation)}</p>
          <a className="instrument-link" href={href}>Open trade check</a>
        </div>
        <div className="measure-cell">
          <span className="measure-label">Live on-chain price</span>
          {snapshot.onchainPrice === null ? (
            <strong className="measure-unavailable">Unavailable</strong>
          ) : (
            <NumberFlow className="measure-number" value={snapshot.onchainPrice} format={moneyFormat} animated={!reduceMotion} />
          )}
          <small>Jupiter Price v3, block {snapshot.jupiterBlockId ?? "unavailable"}</small>
        </div>
        <div className="measure-cell">
          <span className="measure-label">Tessera mark</span>
          {token.markPrice === null ? (
            <strong className="measure-unavailable">Unavailable</strong>
          ) : (
            <NumberFlow className="measure-number" value={token.markPrice} format={moneyFormat} animated={!reduceMotion} />
          )}
          <small>Tessera&apos;s published valuation mark</small>
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

      <footer className="instrument-foot">
        <p>
          <strong>Cheapest route:</strong> {routeSummary(snapshot)}. At the live price, {token.symbol} prices{" "}
          {token.company} at {compactValuation(snapshot.impliedValuation)}.
          {snapshot.degradedReason ? ` Measurement withheld: ${snapshot.degradedReason}.` : ""}
        </p>
      </footer>
    </motion.article>
  );
}

function WatchRow({ entry }: { entry: TesseraWatchlistEntry }) {
  const reduceMotion = usePrefersReducedMotion();
  const { snapshot } = entry;
  const { token } = snapshot;
  const dangerousDepth = entry.depth.maxFillableUsd !== null && entry.depth.maxFillableUsd < 1_000;

  return (
    <a className="watch-row" data-state={entry.gate} href={`/tessera/${encodeURIComponent(token.symbol)}`}>
      <span className="watch-row__signal" aria-hidden="true" />
      <span className="watch-row__identity">
        <strong>{token.symbol}</strong>
        <small>{token.sector ?? token.company}</small>
      </span>
      <span className="watch-row__measure">
        <small>Live price</small>
        {snapshot.onchainPrice !== null ? (
          <NumberFlow value={snapshot.onchainPrice} format={moneyFormat} animated={!reduceMotion} />
        ) : <strong>—</strong>}
      </span>
      <span className="watch-row__measure">
        <small>Tessera mark</small>
        {token.markPrice !== null ? (
          <NumberFlow value={token.markPrice} format={moneyFormat} animated={!reduceMotion} />
        ) : <strong>—</strong>}
      </span>
      <span className="watch-row__measure watch-row__premium">
        <small>Gap</small>
        {snapshot.premiumPct !== null ? (
          <NumberFlow value={snapshot.premiumPct} format={percentFormat} suffix="%" animated={!reduceMotion} />
        ) : <strong>Not measured</strong>}
      </span>
      <span className="watch-row__measure watch-row__depth">
        <small>Depth at 1%</small>
        <strong>{compactDollars(entry.depth.maxFillableUsd)}</strong>
        {dangerousDepth && <em>Size danger</em>}
      </span>
      <span className="watch-row__status">
        <small>{routeSummary(snapshot)}</small>
      </span>
    </a>
  );
}

export function TesseraWatchlist() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["tessera-watchlist"],
    queryFn: fetchTesseraWatchlist,
    refetchInterval: 15_000,
  });

  if (isPending) return <LoadingRows />;
  if (error || !data || data.entries.length === 0) {
    return (
      <div className="source-failure" role="status">
        <div>
          <strong>Tessera measurement interrupted</strong>
          <p>
            {error instanceof Error
              ? error.message
              : data?.archiveDegradedReason ?? "The Tessera source returned no tokens."}{" "}
            Retrying in 15 seconds.
          </p>
        </div>
        <button type="button" onClick={() => void refetch()}>Measure again</button>
      </div>
    );
  }

  return (
    <div>
      <HeadlineInstrument entry={data.entries[0]} fetching={isFetching} />

      <div className="watch-table-head" aria-hidden="true">
        <span>T-Token</span>
        <span>Live price</span>
        <span>Tessera mark</span>
        <span>Gap</span>
        <span>Depth</span>
      </div>
      <div className="watch-rows">
        {data.entries.map((entry) => <WatchRow entry={entry} key={entry.snapshot.token.symbol} />)}
      </div>
      <p className="watchlist-note">
        Sorted by absolute premium to Tessera&apos;s mark. Live prices come from Jupiter Price v3; Tessera publishes no
        timestamp for its mark. &ldquo;Cheaper&rdquo; compares the company valuation each live token price implies.
        {data.comparisonError ? ` PreStocks comparison unavailable: ${data.comparisonError}.` : ""}
      </p>
    </div>
  );
}
