import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TradePanel } from "@/components/trade-panel";
import { findTrackedAsset } from "@/lib/tracked-assets";

export async function generateMetadata(
  props: { params: Promise<{ symbol: string }> },
): Promise<Metadata> {
  const { symbol } = await props.params;
  const tracked = findTrackedAsset(symbol);
  return {
    title: tracked ? `${tracked.symbol} trade check — FairPrint` : "Ticker not tracked — FairPrint",
    description: tracked
      ? `Measure ${tracked.symbol} premium and executable depth before trading.`
      : "Choose a tracked tokenized stock.",
  };
}

export default async function TickerDetailPage(
  props: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await props.params;
  const tracked = findTrackedAsset(symbol);
  if (!tracked) notFound();

  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>Pre-trade execution measurement</strong>
          <span>Premium and route depth are independent checks</span>
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
        <TradePanel symbol={tracked.symbol} />
        <footer className="site-foot trade-page__foot">
          <p>FairPrint explains measured execution cost, not future performance.</p>
          <p>xStocks are intended for eligible non-US users and are not available to US persons.</p>
        </footer>
      </div>
    </main>
  );
}
