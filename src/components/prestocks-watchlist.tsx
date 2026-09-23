"use client";

import NumberFlow, {
  usePrefersReducedMotion,
  type NumberFlowProps,
} from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import type { PreStocksWatchlistEntry, PreStocksWatchlistResponse } from "@/lib/prestocks-types";

interface MarketError {
  error: string;
  action: string;
}

async function fetchPreStocksWatchlist(): Promise<PreStocksWatchlistResponse> {
  const response = await fetch("/api/prestocks", { cache: "no-store" });
  if (!response.ok) {
    const failure = (await response.json()) as MarketError;
    throw new Error(`${failure.error}. ${failure.action}`);
  }
  return (await response.json()) as PreStocksWatchlistResponse;
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

function compactDollars(value: number | null) {
  if (value === null) return "Not measured";
  if (value >= 100_000) return "$100k+";
  if (value >= 1_000) return `$${Math.floor(value / 100) / 10}k`;
  return `$${Math.floor(value).toLocaleString("en-US")}`;
}

function LoadingRows() {
  return (
    <div className="watch-rows" aria-label="Measuring PreStocks assets">
      {Array.from({ length: 4 }, (_, index) => (
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

function WidestGapInstrument({
  entry,
  fetching,
}: {
  entry: PreStocksWatchlistEntry;
  fetching: boolean;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const { asset } = entry;
  const complete = asset.tokenPrice !== null && asset.markPrice !== null;

  return (
    <motion.article
      className="ticker-instrument"
      data-state={entry.gate}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      aria-labelledby="prestocks-headline-symbol"
    >
      <header className="instrument-head">
        <div>
          <span className="source-pulse" data-active={fetching} aria-hidden="true" />
          {fetching ? "Remeasuring" : "Largest live gap"}
        </div>
        <span>PreStocks mark fetched {relativeAge(asset.fetchedAt)}</span>
      </header>

      <div className="ticker-row ticker-row--depth">
        <div className="ticker-identity">
          <h2 id="prestocks-headline-symbol">{asset.symbol}</h2>
          <p>{asset.name}</p>
          <a className="instrument-link" href={`/prestocks/${encodeURIComponent(asset.symbol)}`}>
            Open trade check
          </a>
        </div>
        <div className="measure-cell">
          <span className="measure-label">Token price</span>
          {asset.tokenPrice === null ? (
            <strong className="measure-unavailable">Unavailable</strong>
          ) : (
            <NumberFlow className="measure-number" value={asset.tokenPrice} format={moneyFormat} animated={!reduceMotion} />
          )}
          <small>The token&apos;s actual on-chain price</small>
        </div>
        <div className="measure-cell">
          <span className="measure-label">PreStocks mark</span>
          {asset.markPrice === null ? (
            <strong className="measure-unavailable">Unavailable</strong>
          ) : (
            <NumberFlow className="measure-number" value={asset.markPrice} format={moneyFormat} animated={!reduceMotion} />
          )}
          <small>PreStocks&apos; own fundamental valuation mark</small>
        </div>
        <div className="measure-cell measure-cell--verdict">
          <span className="measure-label">Premium / discount</span>
          {asset.premiumPct === null ? (
            <strong className="measure-unavailable">Not measured</strong>
          ) : (
            <NumberFlow
              className="measure-number measure-number--premium"
              value={asset.premiumPct}
              format={percentFormat}
              suffix="%"
              animated={!reduceMotion}
            />
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
          <p className="degraded-note">
            Measurement withheld: {asset.degradedReason ?? "a required source is unavailable"}.
          </p>
        </footer>
      )}
    </motion.article>
  );
}

function WatchRow({ entry }: { entry: PreStocksWatchlistEntry }) {
  const reduceMotion = usePrefersReducedMotion();
  const { asset } = entry;
  const dangerousDepth = entry.depth.maxFillableUsd !== null && entry.depth.maxFillableUsd < 1_000;

  return (
    <a className="watch-row" data-state={entry.gate} href={`/prestocks/${encodeURIComponent(asset.symbol)}`}>
      <span className="watch-row__signal" aria-hidden="true" />
      <span className="watch-row__identity">
        <strong>{asset.symbol}</strong>
        <small>{asset.name}</small>
      </span>
      <span className="watch-row__measure">
        <small>Token price</small>
        {asset.tokenPrice !== null ? (
          <NumberFlow value={asset.tokenPrice} format={moneyFormat} animated={!reduceMotion} />
        ) : (
          <strong>—</strong>
        )}
      </span>
      <span className="watch-row__measure">
        <small>PreStocks mark</small>
        {asset.markPrice !== null ? (
          <NumberFlow value={asset.markPrice} format={moneyFormat} animated={!reduceMotion} />
        ) : (
          <strong>—</strong>
        )}
      </span>
      <span className="watch-row__measure watch-row__premium">
        <small>Gap</small>
        {asset.premiumPct !== null ? (
          <NumberFlow value={asset.premiumPct} format={percentFormat} suffix="%" animated={!reduceMotion} />
        ) : (
          <strong>Not measured</strong>
        )}
      </span>
      <span className="watch-row__measure watch-row__depth">
        <small>Depth at 1%</small>
        <strong>{compactDollars(entry.depth.maxFillableUsd)}</strong>
        {dangerousDepth && <em>Size danger</em>}
      </span>
      <span className="watch-row__status">
        <small>{`Fetched ${relativeAge(asset.fetchedAt)}`}</small>
      </span>
    </a>
  );
}

export function PreStocksWatchlist() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["prestocks-watchlist"],
    queryFn: fetchPreStocksWatchlist,
    refetchInterval: 15_000,
  });

  if (isPending) return <LoadingRows />;
  if (error || !data) {
    return (
      <div className="source-failure" role="status">
        <div>
          <strong>PreStocks measurement interrupted</strong>
          <p>
            {error instanceof Error ? error.message : "The PreStocks source is unavailable."} Retrying
            in 15 seconds.
          </p>
        </div>
        <button type="button" onClick={() => void refetch()}>Measure again</button>
      </div>
    );
  }

  if (data.entries.length === 0) {
    return (
      <div className="source-failure" role="status">
        <div>
          <strong>No PreStocks assets returned</strong>
          <p>
            {data.archiveDegradedReason ?? "The PreStocks source returned an empty set."} Retrying in{" "}
            {data.retryAfterSeconds} seconds.
          </p>
        </div>
        <button type="button" onClick={() => void refetch()}>Measure again</button>
      </div>
    );
  }

  const headline = data.entries[0];

  return (
    <div>
      <WidestGapInstrument entry={headline} fetching={isFetching} />

      <div className="watch-table-head" aria-hidden="true">
        <span>PreStocks asset</span>
        <span>Token price</span>
        <span>PreStocks mark</span>
        <span>Gap</span>
        <span>Depth</span>
      </div>
      <div className="watch-rows">
        {data.entries.map((entry) => (
          <WatchRow entry={entry} key={entry.symbol} />
        ))}
      </div>
      <p className="watchlist-note">
        Sorted by absolute premium. PreStocks has no timestamp field, so ages shown are FairPrint&apos;s
        own poll time, not source-native freshness. Depth is the latest archived Jupiter binary search
        and refreshes independently every 60 seconds.
      </p>
    </div>
  );
}
