import type { Metadata } from "next";
import Link from "next/link";
import { PoolLookup } from "@/components/pool-lookup";
import { PoolMonitor } from "@/components/pool-monitor";
import { EXAMPLE_POOLS } from "@/lib/dbc-monitor";
import { findTrackedAsset, TRACKED_ASSETS } from "@/lib/tracked-assets";

export async function generateMetadata(props: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await props.params;
  return {
    title: `DBC pool ${address.slice(0, 4)}…${address.slice(-4)} — FairPrint Launch Lab`,
    description: "Live Meteora Dynamic Bonding Curve pool state measured against the real share price.",
  };
}

export default async function PoolPage(props: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { address } = await props.params;
  const { ref } = await props.searchParams;
  const refSymbol = ref ? findTrackedAsset(ref)?.symbol ?? null : null;

  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>DBC pool monitor</strong>
          <span>On-chain state from Solana mainnet, measured against the real share price</span>
          <span className="market-strip__network">Solana mainnet</span>
        </div>
      </div>
      <div className="page-shell trade-page">
        <header className="site-head">
          <Link className="wordmark" href="/" aria-label="FairPrint home">
            <span className="wordmark__caliper" aria-hidden="true" />
            FairPrint
          </Link>
          <span className="tagline">Know what you&apos;re actually paying.</span>
        </header>
        <section className="trade-panel pool-page" aria-labelledby="pool-title">
          <header className="trade-panel__status">
            <Link href="/launch">Back to Launch Lab</Link>
            <span>Meteora Dynamic Bonding Curve</span>
          </header>
          <h1 id="pool-title" className="pool-page__title">
            Pool {address.slice(0, 4)}…{address.slice(-4)}
            {refSymbol ? ` vs ${refSymbol.replace(/x$/, "")} fair value` : ""}
          </h1>
          <PoolMonitor address={address} refSymbol={refSymbol} />
          <PoolLookup
            symbols={TRACKED_ASSETS.map((asset) => asset.symbol)}
            examples={EXAMPLE_POOLS}
            initialAddress={address}
            initialRef={refSymbol ?? ""}
          />
        </section>
        <footer className="site-foot trade-page__foot">
          <p>FairPrint reads public on-chain state and explains it; it does not sign or send transactions.</p>
          <p>Nothing here is investment advice.</p>
        </footer>
      </div>
    </main>
  );
}
