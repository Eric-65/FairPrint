import type { Metadata } from "next";
import Link from "next/link";
import { PreStocksWatchlist } from "@/components/prestocks-watchlist";

export const metadata: Metadata = {
  title: "PreStocks mispricing watch — FairPrint",
  description:
    "Premium and executable depth for PreStocks pre-IPO tokens, measured against PreStocks' own valuation mark.",
};

export default function PreStocksPage() {
  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>PreStocks reference context</strong>
          <span>Reference is PreStocks&apos; own valuation mark, not a market close</span>
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
          <nav className="site-head__nav" aria-label="Sections">
            <Link href="/">xStocks</Link>
            <Link href="/prestocks" aria-current="page">PreStocks</Link>
            <Link href="/tessera">Tessera</Link>
          </nav>
        </header>

        <section className="watchlist" aria-labelledby="prestocks-watchlist-title">
          <div className="section-rule">
            <h2 id="prestocks-watchlist-title">PreStocks mispricing watch</h2>
            <p>Every PreStocks pre-IPO token, refreshed every 15 seconds</p>
          </div>
          <PreStocksWatchlist />
        </section>

        <aside className="source-method" aria-labelledby="prestocks-method-title">
          <h2 id="prestocks-method-title">How to read this measurement</h2>
          <div className="method-columns">
            <p>
              <strong>Token price</strong>
              The token&apos;s actual on-chain price, as reported by PreStocks.
            </p>
            <p>
              <strong>PreStocks mark</strong>
              PreStocks&apos; own fundamental valuation for the private company. This is not a market
              close or an independent oracle.
            </p>
            <p>
              <strong>Premium</strong>
              (tokenPrice − markPrice) / markPrice. These assets are PreStocks-only and kept separate
              from the xStocks watchlist.
            </p>
          </div>
        </aside>

        <footer className="site-foot">
          <p>FairPrint explains measured execution cost, not future performance. Nothing here is investment advice.</p>
          <p>PreStocks tokens are SPV exposure to a private company&apos;s valuation, not direct equity.</p>
        </footer>
      </div>
    </main>
  );
}
