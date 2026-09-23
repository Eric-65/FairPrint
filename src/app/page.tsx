import Link from "next/link";
import { AnimatedHero } from "@/components/animated-hero";
import { Watchlist } from "@/components/ticker-row";
import { TRACKED_ASSETS } from "@/lib/tracked-assets";

export default function HomePage() {
  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>US reference market context</strong>
          <span>Live status comes from the xStocks asset record</span>
          <span className="market-strip__network">Solana mainnet</span>
        </div>
      </div>

      <div className="page-shell page-grid">
        <header className="site-head">
          <a className="wordmark" href="#top" aria-label="FairPrint home">
            <span className="wordmark__caliper" aria-hidden="true" />
            FairPrint
          </a>
          <span className="tagline">Know what you&apos;re actually paying.</span>
          <nav className="site-head__nav" aria-label="Sections">
            <Link href="/" aria-current="page">xStocks</Link>
            <Link href="/prestocks">PreStocks</Link>
          </nav>
        </header>

        <AnimatedHero />

        <section className="watchlist" aria-labelledby="watchlist-title">
          <div className="section-rule">
            <h2 id="watchlist-title">Mispricing watch</h2>
            <p>{TRACKED_ASSETS.length} xStocks on Solana, refreshed every 15 seconds</p>
          </div>
          <Watchlist />
        </section>

        <aside className="source-method" aria-labelledby="method-title">
          <h2 id="method-title">How to read this measurement</h2>
          <div className="method-columns">
            <p>
              <strong>On-chain</strong>
              Jupiter Price v3 reports the latest reliable Solana swap price. It is not presented as an official stock print.
            </p>
            <p>
              <strong>Reference</strong>
              The xStocks issuer quote is used when published; Pyth&apos;s equity feed is the traceable fallback when the issuer window is closed.
            </p>
            <p>
              <strong>Premium</strong>
              The signed percentage is computed from the two displayed raw values. Open “Audit the calculation” to reproduce it.
            </p>
          </div>
        </aside>

        <footer className="site-foot">
          <p>FairPrint explains execution cost, not future performance. Nothing here is investment advice.</p>
          <p>xStocks are intended for eligible non-US users and are not available to US persons.</p>
          <p className="photo-credit">
            São Paulo photograph by{" "}
            <a href="https://www.pexels.com/@rrodriguesim" target="_blank" rel="noreferrer">
              Rafael Rodrigues / Pexels
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
