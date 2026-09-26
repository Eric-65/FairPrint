"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentCheck, AgentStatusResponse } from "@/lib/agent-types";

interface ApiError {
  error: string;
  action: string;
  detail?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const failure = (await response.json()) as ApiError;
    throw new Error(`${failure.error}. ${failure.action}${failure.detail ? ` ${failure.detail}` : ""}`);
  }
  return (await response.json()) as T;
}

const significant = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

function usd(value: number | null) {
  if (value === null) return "—";
  if (value >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${significant.format(value)}`;
}

function compactUsd(value: number | null) {
  if (value === null) return "—";
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function signedPct(value: number | null, digits = 2) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function depthLabel(value: number | null) {
  if (value === null) return "Not measured";
  if (value === 0) return "Under $100";
  return compactUsd(value);
}

function TokenReport({ status }: { status: Extract<AgentStatusResponse, { configured: true }> }) {
  const { token, quote, price, market, depth, links } = status;
  const symbol = token.symbol ? `$${token.symbol}` : "The agent token";
  // Launchpad tokens have ~1B supply, so a single token is worth a tiny
  // fraction of a share; quote per million to keep the figure readable.
  const perUnit = price.inQuote !== null && price.inQuote < 0.001 ? 1_000_000 : 1;
  const gap = price.usd !== null && price.usdAtReference !== null && price.usd > 0
    ? ((price.usdAtReference - price.usd) / price.usd) * 100
    : null;

  return (
    <>
      <h2 id="agent-hero-title">
        {symbol} trades in {quote.symbol}: every swap settles in tokenized {quote.underlying ?? "stock"}.
      </h2>
      <p className="route-hero__lede">
        Launched through Clawpump into a Meteora pool quoted in {quote.symbol}, so the agent&apos;s fees accrue in a
        real-world asset. FairPrint measures its own pool the way it measures every xStock, and gives any agent the
        same check through one API call.
      </p>

      <div className="route-cards">
        <div className="route-card" data-below="true">
          <span className="route-card__company">Price in {quote.symbol}</span>
          <strong className="route-card__figure">
            {price.inQuote === null ? "—" : significant.format(price.inQuote * perUnit)}
          </strong>
          <span className="route-card__label">
            {quote.symbol} per {perUnit === 1 ? "" : "1M "}{symbol}, set by the Meteora pool
          </span>
          <dl>
            <div><dt>At the on-chain {quote.symbol} price</dt><dd>{usd(price.usd)}</dd></div>
            <div><dt>At the real {quote.underlying ?? "share"} price</dt><dd>{usd(price.usdAtReference)}</dd></div>
            <div><dt>{quote.symbol} premium to its share</dt><dd>{signedPct(quote.premiumPct)}</dd></div>
          </dl>
          <small>
            {gap === null
              ? `Valued in ${quote.symbol}, the token inherits any gap between ${quote.symbol} and the real share.`
              : `Because the pool is quoted in ${quote.symbol}, ${symbol}'s dollar price is ${Math.abs(gap).toFixed(2)}% ${gap > 0 ? "below" : "above"} what its ${quote.symbol} is worth at the real share price.`}
          </small>
        </div>

        <div className="route-card">
          <span className="route-card__company">Pool and market</span>
          <strong className="route-card__figure">{compactUsd(market.liquidityUsd)}</strong>
          <span className="route-card__label">liquidity across {symbol}&apos;s pools</span>
          <dl>
            <div><dt>Depth at 1%</dt><dd>{depthLabel(depth.depth1PctUsd)}</dd></div>
            <div><dt>Holders</dt><dd>{market.holders === null ? "—" : market.holders.toLocaleString("en-US")}</dd></div>
            <div><dt>24h volume</dt><dd>{compactUsd(market.volume24hUsd)}</dd></div>
            <div><dt>Market cap</dt><dd>{compactUsd(market.mcapUsd)}</dd></div>
            {market.bondingCurvePct !== null && (
              <div><dt>Bonding curve</dt><dd>{market.bondingCurvePct.toFixed(1)}%</dd></div>
            )}
          </dl>
          <small>{depth.route ? `Route: ${depth.route}` : "Liquidity and holders from Jupiter; depth from live Jupiter quotes."}</small>
        </div>

        <div className="route-card">
          <span className="route-card__company">On-chain proof</span>
          <strong className="route-card__figure agent-mint" title={token.mint}>
            {token.mint.slice(0, 4)}…{token.mint.slice(-4)}
          </strong>
          <span className="route-card__label">{token.name ?? "Agent token"} mint on Solana mainnet</span>
          <ul className="agent-links">
            <li><a href={links.solscan} target="_blank" rel="noreferrer">Token on Solscan</a></li>
            {links.pool && <li><a href={links.pool} target="_blank" rel="noreferrer">Meteora pool on Solscan</a></li>}
            {links.clawpump && <li><a href={links.clawpump} target="_blank" rel="noreferrer">Agent on Clawpump</a></li>}
            <li><a href={links.swap} target="_blank" rel="noreferrer">Swap {quote.symbol} → {symbol} on Jupiter</a></li>
          </ul>
        </div>
      </div>
      {status.degraded && <p className="watchlist-note">Partly measured: {status.degraded}.</p>}
    </>
  );
}

const noSubscription = () => () => {};

function AgentCheckDemo({ symbols, defaultSymbol }: { symbols: string[]; defaultSymbol: string }) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [notional, setNotional] = useState(1_000);
  const [query, setQuery] = useState({ symbol: defaultSymbol, notional: 1_000 });
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");

  useEffect(() => {
    const timer = window.setTimeout(
      () => setQuery({ symbol, notional: Math.min(100_000, Math.max(100, notional || 1_000)) }),
      350,
    );
    return () => window.clearTimeout(timer);
  }, [symbol, notional]);

  const path = `/api/agent/check?symbol=${encodeURIComponent(query.symbol)}&notional=${query.notional}`;
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["agent-check", query.symbol, query.notional],
    queryFn: () => fetchJson<AgentCheck>(path),
    // Each check spends Jupiter quota; 30s keeps a watching judge from starving the poller.
    refetchInterval: 30_000,
  });

  return (
    <section className="agent-check" data-state={data?.verdict ?? "unavailable"} aria-labelledby="agent-check-title">
      <div className="section-rule">
        <h2 id="agent-check-title">The check every agent runs before it trades a stock</h2>
        <p>Live, refreshed every 30 seconds</p>
      </div>

      <div className="agent-check__inputs">
        <label>
          xStock
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
            {symbols.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Order size (USD)
          <input
            inputMode="decimal"
            type="number"
            min="100"
            max="100000"
            step="100"
            value={notional}
            onChange={(event) => setNotional(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>
      </div>

      <code className="agent-check__request">GET {origin}{path}</code>

      {isPending ? (
        <div className="trade-panel-loading"><span className="skeleton skeleton--number" /><span>Measuring premium and depth</span></div>
      ) : error || !data ? (
        <p className="watchlist-note">{error instanceof Error ? error.message : "Check unavailable."} Retrying in 30 seconds.</p>
      ) : (
        <div className="execution-gate" data-gate={data.verdict} data-refreshing={isFetching}>
          <div>
            <span>verdict · proceed: {String(data.proceed)}</span>
            <strong>{data.verdict}</strong>
            <p>{data.reason}</p>
            {data.degraded && <p className="agent-check__degraded">Why: {data.degraded}.</p>}
          </div>
          <dl className="agent-check__fields">
            <div><dt>premiumPct</dt><dd>{signedPct(data.premiumPct, 3)}</dd></div>
            <div><dt>depth1PctUsd</dt><dd>{depthLabel(data.depth1PctUsd)}</dd></div>
            <div><dt>allInCostUsd</dt><dd>{data.allInCostUsd === null ? "—" : usd(Math.abs(data.allInCostUsd))}</dd></div>
            <div><dt>market.period</dt><dd>{data.market.period}</dd></div>
            <div><dt>referencePrice</dt><dd>{usd(data.referencePrice)}</dd></div>
            <div>
              <dt>onchainPrice{data.priceSource === "archive" ? " (recorded)" : ""}</dt>
              <dd>{usd(data.onchainPrice)}</dd>
            </div>
          </dl>
        </div>
      )}

      <p className="agent-check__skill">
        Give an agent this skill and it checks before every xStock trade:{" "}
        <a href="/skill.md" target="_blank" rel="noreferrer">{origin}/skill.md</a>
        {" · "}
        <a href={path} target="_blank" rel="noreferrer">Raw JSON</a>
      </p>
    </section>
  );
}

export function AgentPanel({ symbols }: { symbols: string[] }) {
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["agent-status"],
    queryFn: () => fetchJson<AgentStatusResponse>("/api/agent"),
    refetchInterval: 30_000,
  });
  const quoteSymbol = data?.configured ? data.quote.symbol : data?.quoteSymbol ?? "TSLAx";

  return (
    <>
      <section className="route-hero" aria-labelledby="agent-hero-title" data-refreshing={isFetching}>
        <p className="route-hero__eyebrow">Stocknized agent · Clawpump × Meteora</p>
        {isPending ? (
          <div className="trade-panel-loading"><span className="skeleton skeleton--number" /><span>Measuring the agent token</span></div>
        ) : error || !data ? (
          <>
            <h2 id="agent-hero-title">The FairPrint Agent</h2>
            <p className="watchlist-note">{error instanceof Error ? error.message : "Agent token unavailable."} Retrying in 30 seconds.</p>
          </>
        ) : data.configured ? (
          <TokenReport status={data} />
        ) : (
          <>
            <h2 id="agent-hero-title">An agent that checks the price before it touches a stock.</h2>
            <p className="route-hero__lede">
              The FairPrint Agent token launches through Clawpump into a Meteora pool quoted in {quoteSymbol}. Until it
              is live, the agent check below already works for any agent that wants to trade tokenized stocks.
            </p>
          </>
        )}
      </section>

      <AgentCheckDemo symbols={symbols} defaultSymbol={quoteSymbol} />
    </>
  );
}
