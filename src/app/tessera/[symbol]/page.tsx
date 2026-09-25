import type { Metadata } from "next";
import Link from "next/link";
import { TesseraPanel } from "@/components/tessera-panel";

export async function generateMetadata(
  props: { params: Promise<{ symbol: string }> },
): Promise<Metadata> {
  const { symbol } = await props.params;
  return {
    title: `${symbol} trade check — FairPrint Tessera`,
    description: `Measure ${symbol}'s premium, market-implied valuation, and executable depth before trading.`,
  };
}

export default async function TesseraDetailPage(
  props: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await props.params;

  return (
    <main>
      <div className="market-strip" role="status">
        <div className="page-shell market-strip__inner">
          <span className="market-strip__signal" aria-hidden="true" />
          <strong>Pre-trade execution measurement</strong>
          <span>Tessera mints only — checked against Tessera&apos;s live list before every quote</span>
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
        <TesseraPanel symbol={symbol} />
        <footer className="site-foot trade-page__foot">
          <p>FairPrint explains measured execution cost, not future performance.</p>
          <p>T-Tokens represent loan participation rights, not securities.</p>
        </footer>
      </div>
    </main>
  );
}
