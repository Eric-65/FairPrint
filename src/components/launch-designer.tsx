"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CurveChart } from "@/components/curve-chart";
import type { StockCurveDesign } from "@/lib/dbc-designer";

interface ApiError {
  error: string;
  action: string;
  detail?: string;
}

async function fetchDesign(query: string): Promise<StockCurveDesign> {
  const response = await fetch(`/api/launch/design?${query}`, { cache: "no-store" });
  if (!response.ok) {
    const failure = (await response.json()) as ApiError;
    throw new Error(`${failure.error}. ${failure.detail ?? failure.action}`);
  }
  return (await response.json()) as StockCurveDesign;
}

const significant = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 });

function usd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${significant.format(value)}`;
}

function signedPct(value: number, digits = 2) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%`;
}

function sdkSnippet(design: StockCurveDesign) {
  return `import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient, deriveTokenBadgeAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";

// config.json = the "Config parameters" block from FairPrint (numbers are strings)
import params from "./config.json";

const connection = new Connection(process.env.SOLANA_RPC_URL!);
const client = new DynamicBondingCurveClient(connection, "confirmed");
const issuer = Keypair.fromSecretKey(/* your wallet */);
const config = Keypair.generate();

// Revive the big numbers FairPrint serialized as strings.
const revive = (value: any): any =>
  typeof value === "string" && /^\\d+$/.test(value) ? new BN(value)
  : Array.isArray(value) ? value.map(revive)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))
  : value;

const tx = await client.partner.createConfigAndPool({
  ...revive(params),
  config: config.publicKey,
  feeClaimer: issuer.publicKey,
  leftoverReceiver: issuer.publicKey,
  payer: issuer.publicKey,
  quoteMint: new PublicKey("${design.quote.mint}"), // ${design.quote.symbol}${design.quote.symbol === "USDC" ? "" : `
  // xStocks are Token-2022 mints that Meteora whitelists with a token badge.
  tokenBadge: deriveTokenBadgeAddress(new PublicKey("${design.quote.mint}")),`}
  preCreatePoolParam: {
    baseMint: Keypair.generate().publicKey, // sign with this keypair too
    name: "${design.base.name} / ${design.quote.symbol}",
    symbol: "s${design.base.symbol.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 8)}",
    uri: "https://your-metadata.json",
    poolCreator: issuer.publicKey,
  },
});`;
}

const DEFAULTS = { base: "AMDx", quote: "TSLAx", fair: "", name: "", raise: "5000", start: "15", corridor: "2", grad: "5" };

export function LaunchDesigner({ symbols }: { symbols: string[] }) {
  const [form, setForm] = useState(DEFAULTS);
  const [query, setQuery] = useState(() => new URLSearchParams(DEFAULTS).toString());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(form);
      if (form.base !== "custom") {
        params.delete("fair");
        params.delete("name");
      }
      setQuery(params.toString());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form]);

  const { data, error, isPending, isPlaceholderData } = useQuery({
    queryKey: ["launch-design", query],
    queryFn: () => fetchDesign(query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const configJson = useMemo(() => (data ? JSON.stringify(data.config, null, 2) : ""), [data]);
  const update = (key: keyof typeof DEFAULTS) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1_800);
    } catch {
      setCopied("Copy failed");
    }
  }

  return (
    <section className="launch-designer" aria-labelledby="designer-title">
      <div className="section-rule">
        <h2 id="designer-title">Design a curve</h2>
        <p>Every figure uses live FairPrint prices; the config passes the DBC SDK&apos;s own validation</p>
      </div>

      <div className="launch-form">
        <label>
          Token to launch
          <select value={form.base} onChange={update("base")}>
            {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol.replace(/x$/, "")} share</option>)}
            <option value="custom">Custom — enter a fair value</option>
          </select>
        </label>
        {form.base === "custom" ? (
          <>
            <label>
              Name
              <input value={form.name} maxLength={40} placeholder="e.g. Acme pre-IPO" onChange={update("name")} />
            </label>
            <label>
              Fair value per token (USD)
              <input inputMode="decimal" type="number" min="0" step="0.01" value={form.fair} placeholder="12.50" onChange={update("fair")} />
            </label>
          </>
        ) : null}
        <label>
          Quote token (buyers pay in)
          <select value={form.quote} onChange={update("quote")}>
            {symbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            <option value="USDC">USDC</option>
          </select>
        </label>
        <label>
          Raise at graduation (USD)
          <input inputMode="decimal" type="number" min="500" max="1000000" step="500" value={form.raise} onChange={update("raise")} />
        </label>
        <label>
          Opening discount (%)
          <input inputMode="decimal" type="number" min="5" max="40" step="1" value={form.start} onChange={update("start")} />
        </label>
        <label>
          Fair-value corridor (± %)
          <input inputMode="decimal" type="number" min="0.5" max="5" step="0.5" value={form.corridor} onChange={update("corridor")} />
        </label>
        <label>
          Graduates at (% above fair)
          <input inputMode="decimal" type="number" min="1" max="20" step="0.5" value={form.grad} onChange={update("grad")} />
        </label>
      </div>

      {isPending ? (
        <div className="trade-panel-loading"><span className="skeleton skeleton--number" /><span>Building the curve with the DBC SDK</span></div>
      ) : error && !data ? (
        <p className="watchlist-note">{error instanceof Error ? error.message : "The curve could not be designed."}</p>
      ) : data ? (
        <div className="launch-result" data-refreshing={isPlaceholderData}>
          {error ? <p className="watchlist-note">{error instanceof Error ? error.message : ""} Showing the last valid design.</p> : null}

          <div className="execution-gate" data-gate={data.readiness.gate}>
            <div>
              <span>Launch readiness · {data.quote.symbol} quote leg</span>
              <strong>{data.readiness.gate}</strong>
            </div>
            <p>{data.readiness.reason}</p>
          </div>

          <div className="route-cards">
            <div className="route-card" data-below="true">
              <span className="route-card__company">Fair value</span>
              <strong className="route-card__figure">{significant.format(data.anchor.fairInQuote)} {data.quote.symbol}</strong>
              <span className="route-card__label">
                per token = {usd(data.base.fairUsd)} ({data.base.source}) ÷ {usd(data.quote.referenceUsd)} {data.quote.symbol === "USDC" ? "" : `${data.quote.symbol.replace(/x$/, "")} share`}
              </span>
              {data.quote.symbol !== "USDC" ? (
                <small>
                  Anchoring on {data.quote.symbol}&apos;s on-chain price ({usd(data.quote.onchainUsd)}, {signedPct(data.quote.premiumPct)} vs its
                  share) instead would open the curve {Math.abs(data.anchor.anchorErrorPct).toFixed(2)}% {data.anchor.anchorErrorPct < 0 ? "below" : "above"} fair value.
                </small>
              ) : null}
            </div>
            <div className="route-card">
              <span className="route-card__company">Raise at graduation</span>
              <strong className="route-card__figure">{usd(data.totals.thresholdUsd)}</strong>
              <span className="route-card__label">
                {significant.format(data.totals.thresholdInQuote)} {data.quote.symbol}, then the pool migrates to Meteora DAMM v2 with LP permanently locked
              </span>
              <dl>
                <div><dt>Token supply</dt><dd>{data.totals.totalSupply.toLocaleString("en-US")}</dd></div>
                <div><dt>Sold on the curve</dt><dd>{data.totals.pctSoldOnCurve.toFixed(1)}%</dd></div>
                <div><dt>Raise inside the corridor</dt><dd>{data.totals.corridorShareOfRaise.toFixed(0)}%</dd></div>
              </dl>
            </div>
            <div className="route-card">
              <span className="route-card__company">Fees</span>
              <strong className="route-card__figure">{data.fees.startingBps / 100}% → {data.fees.endingBps / 100}%</strong>
              <span className="route-card__label">
                exponential decay over the first hour to deter snipers, then equity-like; dynamic fee on; {data.fees.migratedPoolBps / 100}% after
                graduation. Fees are paid in {data.quote.symbol}.
              </span>
            </div>
          </div>

          <CurveChart
            points={data.chart}
            fairUsd={data.base.fairUsd}
            corridorPct={data.input.corridorPct}
            label={`${data.base.name} launch curve quoted in ${data.quote.symbol}`}
          />

          <div className="launch-ladder">
            <table>
              <thead>
                <tr><th>Price point</th><th>vs fair</th><th>{data.quote.symbol} per token</th><th>USD</th><th>Raised so far</th><th>Tokens sold</th></tr>
              </thead>
              <tbody>
                {data.ladder.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{signedPct((row.multiplier - 1) * 100, 1)}</td>
                    <td>{significant.format(row.priceInQuote)}</td>
                    <td>{usd(row.priceUsd)}</td>
                    <td>{usd(row.raisedUsd)}</td>
                    <td>{significant.format(row.baseSold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="watchlist-note">
              Liquidity weights {data.weights.join(" : ")} across the three segments: thin below the corridor so early buyers close the
              discount fast, dense inside it so price settles at fair value, and heavier above it so graduation takes real demand.
            </p>
          </div>

          <div className="launch-validation" data-valid={data.validation.valid}>
            {data.validation.valid
              ? "✓ Passes validateConfigParameters from @meteora-ag/dynamic-bonding-curve-sdk — ready for createConfig on mainnet."
              : `✗ The SDK rejected this config: ${data.validation.error}`}
          </div>

          <details className="launch-export">
            <summary>Config parameters (JSON) and launch script</summary>
            <div className="launch-export__actions">
              <button type="button" onClick={() => void copy("Config copied", configJson)}>Copy config JSON</button>
              <button type="button" onClick={() => void copy("Script copied", sdkSnippet(data))}>Copy TypeScript launch script</button>
              {copied ? <span role="status">{copied}</span> : null}
            </div>
            <pre>{configJson}</pre>
            <pre>{sdkSnippet(data)}</pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
