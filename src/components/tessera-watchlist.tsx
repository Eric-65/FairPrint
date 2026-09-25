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

function holdersSummary(snapshot: TesseraSnapshot) {
  const { holders } = snapshot.token;
  return holders === null ? "Holders not published" : `${holders.toLocaleString("en-US")} holders`;
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

function premiumOf(entry: TesseraWatchlistEntry) {
  return entry.snapshot.premiumPct;
}

function RouteHero({ entries, fetching }: { entries: TesseraWatchlistEntry[]; fetching: boolean }) {
  const measured = entries
    .filter((entry) => premiumOf(entry) !== null)
    .sort((a, b) => premiumOf(a)! - premiumOf(b)!);
  const below = measured.filter((entry) => premiumOf(entry)! < -0.05);
  const companies = (list: TesseraWatchlistEntry[]) => listOf(list.map((entry) => entry.snapshot.token.company));

  return (
    <section className="route-hero" aria-labelledby="route-hero-title" data-refreshing={fetching}>
      <p className="route-hero__eyebrow">Market price vs Tessera&apos;s own valuation, measured live</p>
      <h2 id="route-hero-title">
        {below.length > 0
          ? `The market prices ${companies(below)} below Tessera's own valuation.`
          : `What the market pays for ${companies(measured)} on Tessera.`}
      </h2>
      <p className="route-hero__lede">
        FairPrint turns each T-Token&apos;s live Solana price into the company valuation it implies and sets it against
        the valuation Tessera publishes, alongside the size you can actually trade before 1% price impact.
      </p>

      <div className="route-cards">
        {measured.map((entry) => {
          const { snapshot } = entry;
          const premium = premiumOf(entry)!;
          const belowMark = premium < -0.05;
          return (
            <a
              className="route-card"
              data-below={belowMark}
              href={`/tessera/${encodeURIComponent(snapshot.token.symbol)}`}
              key={snapshot.token.symbol}
            >
              <span className="route-card__company">{snapshot.token.company}</span>
              <strong className="route-card__figure">
                {Math.abs(premium).toFixed(1)}% {belowMark ? "below" : premium > 0.05 ? "above" : "at"}
              </strong>
              <span className="route-card__label">Tessera&apos;s own valuation, at the live {snapshot.token.symbol} price</span>
              <dl>
                <div>
                  <dt>Market-implied valuation</dt>
                  <dd>{compactValuation(snapshot.impliedValuation)}</dd>
                </div>
                <div>
                  <dt>Tessera valuation</dt>
                  <dd>{compactValuation(snapshot.token.markValuation)}</dd>
                </div>
                <div>
                  <dt>Depth at 1%</dt>
                  <dd>{compactDollars(entry.depth.maxFillableUsd)}</dd>
                </div>
              </dl>
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
        <small>{holdersSummary(snapshot)}</small>
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
        timestamp for its mark. Market-implied valuation is live price ÷ mark price × Tessera&apos;s valuation.
      </p>
    </div>
  );
}
