import type { Metadata } from "next";
import Link from "next/link";
import { LaunchDesigner } from "@/components/launch-designer";
import { PoolLookup } from "@/components/pool-lookup";
import { SectionNav } from "@/components/section-nav";
import { EXAMPLE_POOLS } from "@/lib/dbc-monitor";
import { TRACKED_ASSETS } from "@/lib/tracked-assets";

export const metadata: Metadata = {
  title: "Launch Lab — fair-value DBC curves for tokenized stocks — FairPrint",
  description:
    "Design Meteora Dynamic Bonding Curve launches for tokenized stocks, anchored to the real share price, and monitor any DBC pool against fair value.",
};

export default function LaunchPage() {
  const symbols = TRACKED_ASSETS.map((asset) => asset.symbol);
  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>Launch Lab</strong>
          <span>Meteora Dynamic Bonding Curve · priced from live share prices</span>
          <span className="market-strip__network">Solana mainnet</span>
        </div>
      </div>

      <div className="page-shell page-grid">
        <header className="site-head">
          <Link className="wordmark" href="/" aria-label="FairPrint home">
            <span className="wordmark__caliper" aria-hidden="true" />
            FairPrint
          </Link>
          <span className="tagline">Know what you&apos;re actually paying.</span>
          <SectionNav current="launch" />
        </header>

        <div className="watchlist">
          <section className="route-hero" aria-labelledby="launch-hero-title">
            <p className="route-hero__eyebrow">Launch Lab · Meteora DBC for tokenized stocks</p>
            <h2 id="launch-hero-title">A stock has a fair price. Its launch curve should know it.</h2>
            <p className="route-hero__lede">
              Memecoin curves start at zero because a memecoin has no fair value. A tokenized stock does: the real share
              price. Launch Lab builds a Dynamic Bonding Curve around it: opening at a discount, liquidity dense in a
              corridor around fair value so price discovery settles there, and graduation only once buyers pay above it.
              The fair price is anchored on the real share prices of both legs, not on a quote token that may itself
              trade at a premium.
            </p>
          </section>

          <LaunchDesigner symbols={symbols} />

          <section className="launch-monitor" aria-labelledby="monitor-title">
            <div className="section-rule">
              <h2 id="monitor-title">Monitor any DBC pool against fair value</h2>
              <p>Reads the pool&apos;s on-chain state from Solana mainnet</p>
            </div>
            <PoolLookup symbols={symbols} examples={EXAMPLE_POOLS} />
          </section>
        </div>

        <aside className="source-method" aria-labelledby="launch-method-title">
          <h2 id="launch-method-title">How the curve is built</h2>
          <div className="method-columns">
            <p>
              <strong>Fair value, both legs</strong>
              The token&apos;s fair price in the quote token is its share price divided by the quote&apos;s share price,
              from the xStocks issuer quote or Pyth. FairPrint measures the quote token&apos;s own premium so it
              doesn&apos;t leak into the anchor, and holds the launch while that premium is above 0.5%.
            </p>
            <p>
              <strong>A corridor, not a pump</strong>
              Three custom sqrt-price segments built with the DBC SDK&apos;s buildCurveWithCustomSqrtPrices: discount to
              corridor floor, the corridor, then up to the graduation price. Supply is sized so graduation lands on the
              dollar raise you set.
            </p>
            <p>
              <strong>Equity-like fees and graduation</strong>
              A 3% anti-snipe fee decays exponentially to 0.30% over the first hour, with dynamic fees on. Fees are paid
              in the quote token, so issuers earn in shares. At graduation the pool migrates to DAMM v2 at 0.25% with
              LP permanently locked.
            </p>
          </div>
        </aside>

        <footer className="site-foot">
          <p>Launch Lab designs and measures; it does not sign or send transactions. Nothing here is investment advice.</p>
          <p>xStocks are intended for eligible non-US users and are not available to US persons.</p>
        </footer>
      </div>
    </main>
  );
}
