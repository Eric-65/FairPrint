"use client";

import NumberFlow, {
  usePrefersReducedMotion,
  type NumberFlowProps,
} from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
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

function listOf(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function discountOf(entry: TesseraWatchlistEntry) {
  return entry.snapshot.comparison?.tesseraDiscountPct ?? null;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function TrackRecordLine({ entry }: { entry: TesseraWatchlistEntry }) {
  const record = entry.trackRecord;
  if (!record || record.readings === 0) {
    return <small>Track record starts with the next minute&apos;s archived reading.</small>;
  }
  return (
    <small>
      Cheaper in {Math.round(record.pctTesseraCheaper)}% of {record.readings.toLocaleString("en-US")} readings since{" "}
      {shortDate(record.firstObservedAt)} · average {record.discountMeanPct >= 0 ? "" : "−"}
      {Math.abs(record.discountMeanPct).toFixed(1)}% {record.discountMeanPct >= 0 ? "below" : "above"} PreStocks
    </small>
  );
}

function RouteHero({ entries, fetching }: { entries: TesseraWatchlistEntry[]; fetching: boolean }) {
  const compared = entries
    .filter((entry) => discountOf(entry) !== null)
    .sort((a, b) => (discountOf(b) ?? 0) - (discountOf(a) ?? 0));
  const winners = compared.filter((entry) => (discountOf(entry) ?? 0) > 0.05);
  const losers = compared.filter((entry) => (discountOf(entry) ?? 0) < -0.05);
  const winnerNames = winners.map((entry) => entry.snapshot.token.company);
  const discounts = winners.map((entry) => discountOf(entry)!);
  const low = Math.min(...discounts);
  const high = Math.max(...discounts);
  const range = winners.length === 1 || high - low < 0.5
    ? `${high.toFixed(0)}%`
    : `${low.toFixed(0)}–${high.toFixed(0)}%`;

  return (
    <section className="route-hero" aria-labelledby="route-hero-title" data-refreshing={fetching}>
      <p className="route-hero__eyebrow">Cheapest on-chain route, measured live</p>
      {winners.length > 0 ? (
        <>
          <h2 id="route-hero-title">
            The cheapest way to own {listOf(winnerNames)} on-chain is Tessera.
          </h2>
          <p className="route-hero__lede">
            Right now T-Tokens price {winners.length === 1 ? "it" : "these companies"} {range} below the same{" "}
            {winners.length === 1 ? "company's" : "companies'"} PreStocks tokens, measured as the company valuation each
            live price implies.
            {losers.length > 0
              ? ` PreStocks is currently cheaper for ${listOf(losers.map((entry) => entry.snapshot.token.company))}.`
              : ""}
          </p>
        </>
      ) : (
        <h2 id="route-hero-title">How Tessera compares for {listOf(compared.map((entry) => entry.snapshot.token.company))}</h2>
      )}

      <div className="route-cards">
        {compared.map((entry) => {
          const { snapshot } = entry;
          const discount = discountOf(entry)!;
          const cheaper = discount > 0.05;
          const prestocks = snapshot.comparison!.prestocks;
          return (
            <a
              className="route-card"
              data-cheaper={cheaper}
              href={`/tessera/${encodeURIComponent(snapshot.token.symbol)}`}
              key={snapshot.token.symbol}
            >
              <span className="route-card__company">{snapshot.token.company}</span>
              <strong className="route-card__figure">
                {Math.abs(discount).toFixed(1)}% {cheaper ? "cheaper" : discount < -0.05 ? "pricier" : "same"}
              </strong>
              <span className="route-card__label">on Tessera than on PreStocks</span>
              <dl>
                <div>
                  <dt>{snapshot.token.symbol}</dt>
                  <dd>{compactValuation(snapshot.impliedValuation)}</dd>
                </div>
                <div>
                  <dt>PreStocks {prestocks.symbol}</dt>
                  <dd>{compactValuation(prestocks.impliedValuation)}</dd>
                </div>
                <div>
                  <dt>{snapshot.token.symbol} depth at 1%</dt>
                  <dd>{compactDollars(entry.depth.maxFillableUsd)}</dd>
                </div>
              </dl>
              <TrackRecordLine entry={entry} />
              <span className="route-card__cta">Check {snapshot.token.symbol} before trading</span>
            </a>
          );
        })}
      </div>
    </section>
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
      <RouteHero entries={data.entries} fetching={isFetching} />

      <div className="section-rule route-hero__rows-title">
        <h3>Premium to Tessera&apos;s own mark</h3>
        <p>Where each T-Token trades against the valuation Tessera publishes for it</p>
      </div>

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
