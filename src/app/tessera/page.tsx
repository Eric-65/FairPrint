import type { Metadata } from "next";
import Link from "next/link";
import { TesseraWatchlist } from "@/components/tessera-watchlist";

export const metadata: Metadata = {
  title: "Tessera T-Token watch — FairPrint",
  description:
    "Live premium, executable depth, and the cheapest route to OpenAI, Kalshi, and SpaceX exposure for Tessera T-Tokens on Solana.",
  twitter: { card: "summary_large_image" },
};

export default function TesseraPage() {
  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>Tessera reference context</strong>
          <span>Reference is Tessera&apos;s own valuation mark; live prices come from Solana DEXs</span>
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
            <Link href="/prestocks">PreStocks</Link>
            <Link href="/tessera" aria-current="page">Tessera</Link>
          </nav>
        </header>

        <section className="watchlist" aria-labelledby="tessera-watchlist-title">
          <div className="section-rule">
            <h2 id="tessera-watchlist-title">Tessera T-Token watch</h2>
            <p>OpenAI, Kalshi, SpaceX, and every other T-Token Tessera lists, refreshed every 15 seconds</p>
          </div>
          <TesseraWatchlist />
        </section>

        <aside className="source-method" aria-labelledby="tessera-method-title">
          <h2 id="tessera-method-title">How to read this measurement</h2>
          <div className="method-columns">
            <p>
              <strong>Live price</strong>
              The T-Token&apos;s latest reliable Solana swap price from Jupiter Price v3.
            </p>
            <p>
              <strong>Tessera mark</strong>
              Tessera&apos;s published valuation mark for the token. It is Tessera&apos;s own number, not a market close
              or an independent oracle.
            </p>
            <p>
              <strong>Cheapest route</strong>
              Each live price converted into the company valuation it implies, so a T-Token can be compared with the
              same company&apos;s token on another venue.
            </p>
          </div>
        </aside>

        <footer className="site-foot">
          <p>FairPrint explains measured execution cost, not future performance. Nothing here is investment advice.</p>
          <p>
            T-Tokens represent loan participation rights, not securities, and are governed by Tessera&apos;s{" "}
            <a href="https://terms.tessera.pe" target="_blank" rel="noreferrer">terms</a>. They are not offered where
            such activity would be unlawful.
          </p>
        </footer>
      </div>
    </main>
  );
}
