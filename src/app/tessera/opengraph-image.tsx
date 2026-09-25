import { ImageResponse } from "next/og";
import { getTesseraSnapshots, type TesseraSnapshot } from "@/lib/tessera";

export const alt = "Tessera T-Tokens: live market price against Tessera's own valuation, measured by FairPrint";
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
    return await getTesseraSnapshots();
  } catch {
    // The card still renders (without live figures) if a source is down at build time.
    return [];
  }
}

export default async function Image() {
  const measured = (await loadSnapshots())
    .filter((snapshot) => snapshot.premiumPct !== null)
    .sort((a, b) => a.premiumPct! - b.premiumPct!);
  const below = measured.filter((snapshot) => snapshot.premiumPct! < -0.05);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: 64, background: GROUND, color: INK }}>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: MUTED }}>FairPrint · Tessera T-Tokens</div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 50, lineHeight: 1.1, letterSpacing: -1.5 }}>
          {below.length > 0
            ? `The market prices ${listOf(below.map((snapshot) => snapshot.token.company))} below Tessera's own valuation.`
            : "Know what you're actually paying for pre-IPO exposure."}
        </div>
        <div style={{ display: "flex", marginTop: "auto", gap: 20 }}>
          {measured.slice(0, 3).map((snapshot) => {
            const premium = snapshot.premiumPct!;
            const belowMark = premium < -0.05;
            return (
              <div
                key={snapshot.token.symbol}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "20px 24px",
                  background: "#ffffff",
                  borderTop: `8px solid ${belowMark ? FAIR : MUTED}`,
                }}
              >
                <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>{snapshot.token.company}</div>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: belowMark ? FAIR : INK, whiteSpace: "nowrap" }}>
                  {`${Math.abs(premium).toFixed(1)}% ${belowMark ? "below" : premium > 0.05 ? "above" : "at"}`}
                </div>
                <div style={{ display: "flex", fontSize: 20, color: MUTED }}>{`Tessera's valuation, at the live ${snapshot.token.symbol} price`}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 20, color: MUTED }}>
          {"Live Solana price vs Tessera's own mark · Not investment advice"}
        </div>
      </div>
    ),
    size,
  );
}
