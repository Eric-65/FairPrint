import type { Metadata } from "next";
import Link from "next/link";
import { PreStocksPanel } from "@/components/prestocks-panel";

export async function generateMetadata(
  props: { params: Promise<{ symbol: string }> },
): Promise<Metadata> {
  const { symbol } = await props.params;
  return {
    title: `${symbol} trade check — FairPrint PreStocks`,
    description: `Measure ${symbol} premium and executable depth against its PreStocks mark before trading.`,
  };
}

export default async function PreStocksDetailPage(
  props: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await props.params;

  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>Pre-trade execution measurement</strong>
          <span>PreStocks-only — mint checked against the live allowlist before every quote</span>
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
        <PreStocksPanel symbol={symbol} />
        <footer className="site-foot trade-page__foot">
          <p>FairPrint explains measured execution cost, not future performance.</p>
          <p>PreStocks tokens are SPV exposure to a private company&apos;s valuation, not direct equity.</p>
        </footer>
      </div>
    </main>
  );
}
