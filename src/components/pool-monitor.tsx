"use client";

import { useQuery } from "@tanstack/react-query";
import type { DbcPoolReport } from "@/lib/dbc-monitor";

interface ApiError {
  error: string;
  action: string;
  detail?: string;
}

async function fetchPool(address: string, ref: string | null): Promise<DbcPoolReport> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const response = await fetch(`/api/launch/pool/${encodeURIComponent(address)}${query}`, { cache: "no-store" });
  if (!response.ok) {
    const failure = (await response.json()) as ApiError;
    throw new Error(`${failure.error}. ${failure.detail ?? failure.action}`);
  }
  return (await response.json()) as DbcPoolReport;
}

const significant = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 });

function usd(value: number | null) {
  if (value === null) return "—";
  if (value >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${significant.format(value)}`;
}

function signedPct(value: number | null, digits = 2) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function PoolMonitor({ address, refSymbol }: { address: string; refSymbol: string | null }) {
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["dbc-pool", address, refSymbol],
    queryFn: () => fetchPool(address, refSymbol),
    refetchInterval: 30_000,
  });

  if (isPending) {
    return <div className="trade-panel-loading"><span className="skeleton skeleton--number" /><span>Reading the pool from Solana mainnet</span></div>;
  }
  if (error || !data) {
    return (
      <div className="source-failure" role="status">
        <div><strong>Pool unavailable</strong><p>{error instanceof Error ? error.message : "The pool could not be read."}</p></div>
      </div>
    );
  }

  const { price, progress, quote, reference } = data;
  // Where the live price sits on the curve's price range, for the ladder bar.
  const span = price.graduation - price.start;
  const position = span > 0 ? Math.min(100, Math.max(0, ((price.inQuote - price.start) / span) * 100)) : 0;
  const gate = progress.migrated ? "fair" : reference?.basisPct == null ? "unavailable" : Math.abs(reference.basisPct) <= 2 ? "fair" : Math.abs(reference.basisPct) <= 5 ? "caution" : "overpay";

  return (
    <div className="pool-monitor" data-refreshing={isFetching}>
      <div className="route-cards">
        <div className="route-card" data-below="true">
          <span className="route-card__company">Price on the curve</span>
          <strong className="route-card__figure">{significant.format(price.inQuote)} {quote.symbol}</strong>
          <span className="route-card__label">per token, read from the pool&apos;s sqrt price on mainnet</span>
          <dl>
            <div><dt>At {quote.symbol}&apos;s on-chain price</dt><dd>{usd(price.usdAtMarket)}</dd></div>
            <div><dt>At the real {quote.symbol.replace(/x$/, "")} share price</dt><dd>{usd(price.usdAtReference)}</dd></div>
            <div><dt>{quote.symbol} premium to its share</dt><dd>{signedPct(quote.premiumPct)}</dd></div>
          </dl>
        </div>

        <div className="route-card">
          <span className="route-card__company">Progress to graduation</span>
          <strong className="route-card__figure">{progress.migrated ? "Graduated" : `${progress.pct.toFixed(1)}%`}</strong>
          <span className="route-card__label">
            {significant.format(progress.quoteReserve)} of {significant.format(progress.threshold)} {quote.symbol} raised
            {progress.migrated ? "; the pool has migrated to Meteora DAMM" : ""}
          </span>
          <div className="pool-progress" role="progressbar" aria-valuenow={Math.round(progress.pct)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress.pct}%` }} />
          </div>
          <dl>
            <div><dt>Trading fees collected</dt><dd>{significant.format(data.fees.totalTradingQuote)} {quote.symbol}</dd></div>
            <div><dt>Unclaimed, creator</dt><dd>{significant.format(data.fees.unclaimedCreatorQuote)} {quote.symbol}</dd></div>
            <div><dt>Unclaimed, partner</dt><dd>{significant.format(data.fees.unclaimedPartnerQuote)} {quote.symbol}</dd></div>
          </dl>
        </div>

        <div className="route-card">
          <span className="route-card__company">Curve range</span>
          <strong className="route-card__figure">{significant.format(price.start)} → {significant.format(price.graduation)}</strong>
          <span className="route-card__label">{quote.symbol} per token, opening to graduation</span>
          <div className="pool-ladder" aria-label={`Live price is ${position.toFixed(0)}% of the way from the opening price to the graduation price`}>
            <span className="pool-ladder__track" />
            {data.curve.map((point) => (
              <i key={point.priceInQuote} style={{ left: `${span > 0 ? ((point.priceInQuote - price.start) / span) * 100 : 0}%` }} />
            ))}
            <b style={{ left: `${position}%` }} />
          </div>
          <small>{data.curve.length} curve segment{data.curve.length === 1 ? "" : "s"}; the marker is the live price.</small>
        </div>
      </div>

      <div className="execution-gate" data-gate={gate}>
        <div>
          <span>Fair-value basis</span>
          <strong>{reference?.basisPct != null ? signedPct(reference.basisPct) : "No reference"}</strong>
        </div>
        <p>
          {reference?.basisPct != null
            ? `At the real share prices, the curve prices this token ${Math.abs(reference.basisPct).toFixed(2)}% ${reference.basisPct < 0 ? "below" : "above"} ${reference.symbol.replace(/x$/, "")}'s share price of ${usd(reference.fairUsd)}.`
            : "Pick the xStock whose share this token tracks to measure how far the curve sits from fair value."}
        </p>
      </div>

      <p className="watchlist-note">
        Pool <a href={data.links.pool} target="_blank" rel="noreferrer">{short(data.address)}</a> · base token{" "}
        <a href={data.links.baseMint} target="_blank" rel="noreferrer">{short(data.baseMint)}</a> · quote {quote.symbol} ({quote.source}) ·{" "}
        <a href={data.links.jupiter} target="_blank" rel="noreferrer">Trade on Jupiter</a> · read {new Date(data.measuredAt).toLocaleTimeString()}
      </p>
    </div>
  );
}
