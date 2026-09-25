import type { Metadata } from "next";
import Link from "next/link";
import { AgentPanel } from "@/components/agent-panel";
import { SectionNav } from "@/components/section-nav";
import { TRACKED_ASSETS } from "@/lib/tracked-assets";

export const metadata: Metadata = {
  title: "FairPrint Agent — a Stocknized agent on Clawpump",
  description:
    "An agent token launched through Clawpump into a Meteora pool quoted in TSLAx, plus the fair-price check any agent can run before it trades a tokenized stock.",
};

export default function AgentPage() {
  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>Stocknized agent</strong>
          <span>Launched through Clawpump · pool on Meteora · quoted in tokenized stock</span>
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
          <SectionNav current="agent" />
        </header>

        <div className="watchlist">
          <AgentPanel symbols={TRACKED_ASSETS.map((asset) => asset.symbol)} />
        </div>

        <aside className="source-method" aria-labelledby="agent-method-title">
          <h2 id="agent-method-title">How the agent works</h2>
          <div className="method-columns">
            <p>
              <strong>Launched on Clawpump</strong>
              The agent&apos;s token is launched through Clawpump into a Meteora pool whose quote asset is a tokenized
              stock, so every buy and sell settles in that stock and trading fees accrue in a real-world asset.
            </p>
            <p>
              <strong>Measured by FairPrint</strong>
              The token is priced in the stock it pairs with, then valued at both the on-chain xStock price and the
              real share price, so the xStock&apos;s own premium is visible instead of hidden inside the dollar price.
            </p>
            <p>
              <strong>A check for every agent</strong>
              Before an agent buys or sells an xStock it calls <code>/api/agent/check</code>{" "}
              and trades only on a
              &ldquo;fair&rdquo; verdict: premium under 0.5% and the order inside measured 1% depth. The rules ship as{" "}
              <a href="/skill.md">skill.md</a>.
            </p>
          </div>
        </aside>

        <footer className="site-foot">
          <p>FairPrint explains measured execution cost, not future performance. Nothing here is investment advice.</p>
          <p>xStocks are intended for eligible non-US users and are not available to US persons.</p>
        </footer>
      </div>
    </main>
  );
}
