import { ImageResponse } from "next/og";
import { getTesseraSnapshots, type TesseraSnapshot } from "@/lib/tessera";

export const alt = "The cheapest on-chain route to OpenAI, Kalshi and SpaceX, measured live by FairPrint";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 600;

const INK = "#141b1a";
const GROUND = "#edefee";
const MUTED = "#5f6a67";
const FAIR = "#0f6e62";

function listOf(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

async function loadSnapshots(): Promise<TesseraSnapshot[]> {
  try {
    return (await getTesseraSnapshots()).snapshots;
  } catch {
    // The card still renders (without live figures) if a source is down at build time.
    return [];
  }
}

export default async function Image() {
  const compared = (await loadSnapshots())
    .filter((snapshot) => snapshot.comparison?.tesseraDiscountPct != null)
    .sort((a, b) => b.comparison!.tesseraDiscountPct! - a.comparison!.tesseraDiscountPct!);
  const winners = compared.filter((snapshot) => snapshot.comparison!.tesseraDiscountPct! > 0.05);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 64, background: GROUND, color: INK }}>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: MUTED }}>FairPrint · Tessera T-Tokens</div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 50, lineHeight: 1.1, letterSpacing: -1.5 }}>
          {winners.length > 0
            ? `The cheapest on-chain way to own ${listOf(winners.map((snapshot) => snapshot.token.company))} is Tessera.`
            : "Know what you're actually paying for pre-IPO exposure."}
        </div>
        <div style={{ display: "flex", marginTop: "auto", gap: 20 }}>
          {compared.slice(0, 3).map((snapshot) => {
            const discount = snapshot.comparison!.tesseraDiscountPct!;
            const cheaper = discount > 0.05;
            return (
              <div
                key={snapshot.token.symbol}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "20px 24px",
                  background: "#ffffff",
                  borderTop: `8px solid ${cheaper ? FAIR : MUTED}`,
                }}
              >
                <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>{snapshot.token.company}</div>
                <div style={{ display: "flex", fontSize: 40, whiteSpace: "nowrap", color: cheaper ? FAIR : INK }}>
                  {`${Math.abs(discount).toFixed(1)}% ${cheaper ? "cheaper" : "pricier"}`}
                </div>
                <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{`${snapshot.token.symbol} vs PreStocks ${snapshot.comparison!.prestocks.symbol}`}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 20, color: MUTED }}>
          Company valuation implied by each live token price · Jupiter Price v3 · Not investment advice
        </div>
      </div>
    ),
    size,
  );
}
