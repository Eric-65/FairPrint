import { agentTokenConfig } from "@/lib/agent-token";
import { TRACKED_ASSETS } from "@/lib/tracked-assets";

export const dynamic = "force-dynamic";

// A skill file any agent runtime (Clawpump, Claude, OpenClaw) can load to learn
// when and how to ask FairPrint before it trades a tokenized stock.
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const agent = agentTokenConfig();
  const symbols = TRACKED_ASSETS.map((asset) => asset.symbol).join(", ");

  const body = `---
name: fairprint
description: Check whether a tokenized stock (xStock) on Solana is fairly priced and liquid enough before buying or selling it. Use before every xStock trade.
---

# FairPrint — fair-price check for tokenized stocks

Tokenized stocks trade on Solana 24/7, but the real share only prices during US market hours, and the on-chain pools can be thin. FairPrint measures, live, how far an xStock trades from its reference price and how much you can trade before 1% price impact, then returns one verdict.

**Call FairPrint before you buy or sell any xStock. Only trade when \`proceed\` is \`true\`.**

## Check a trade

\`\`\`
GET ${origin}/api/agent/check?symbol=TSLAx&notional=1000
\`\`\`

| Parameter | Meaning |
|---|---|
| \`symbol\` | xStock symbol. Supported: ${symbols} |
| \`notional\` | Order size in USD, 100–100000. Default 1000. |
| \`slippage\` | Price-impact limit in %, 0.1–5. Default 1. |

Response fields that matter:

| Field | Meaning |
|---|---|
| \`verdict\` | \`fair\`, \`caution\`, \`overpay\`, \`halted\` or \`unavailable\` |
| \`proceed\` | \`true\` only when \`verdict\` is \`fair\` |
| \`reason\` | One sentence explaining the verdict — log it with your decision |
| \`premiumPct\` | Signed % between the on-chain price and the reference price. Positive = you pay above the real share price |
| \`depth1PctUsd\` | Largest USD order that fills before 1% price impact |
| \`allInCostUsd\` / \`allInCostPct\` | Premium + price impact + fees at your size, versus the reference |
| \`market.period\` | \`market\`, \`extended\`, \`overnight\` or \`closed\` for the underlying exchange |
| \`priceSource\` | \`live\`, or \`archive\` when the live price call failed and a reading at most 5 minutes old was used (see \`priceObservedAt\`) |
| \`degraded\` | Non-null when a source was missing; treat as lower confidence |

## Decision rules

1. \`verdict: fair\` → trade at or below \`notional\`.
2. \`verdict: caution\` → cut the size until \`notional\` is under 60% of \`depth1PctUsd\`, or wait; re-check before trading.
3. \`verdict: overpay\` → do not trade. If \`premiumPct\` > 2 you would pay more than 2% over the real share price; if the order exceeds \`depth1PctUsd\`, split it or wait.
4. \`verdict: halted\` or \`unavailable\`, or an HTTP error → do not trade; retry in 15 seconds.

Never treat a FairPrint verdict as investment advice: it measures execution cost, not where the price will go.

## Example (illustrative values)

\`\`\`bash
curl "${origin}/api/agent/check?symbol=NVDAx&notional=2500"
\`\`\`

\`\`\`json
{ "symbol": "NVDAx", "verdict": "caution", "proceed": false,
  "reason": "The token is between 0.5% and 2% away from its reference price.",
  "premiumPct": 0.82, "depth1PctUsd": 41200, "allInCostPct": 0.97 }
\`\`\`

## Other endpoints

- \`GET ${origin}/api/market\` — every tracked xStock with premium, depth and gate, refreshed every 15 seconds.
- \`GET ${origin}/api/agent\` — the FairPrint Agent token: price in its stock pair, pool and market data.
${agent ? `
## The FairPrint Agent token

FairPrint's own agent token was launched through Clawpump into a Meteora pool quoted in **${agent.quoteSymbol}**, so every trade settles in tokenized stock and fees accrue in it.

- Mint: \`${agent.mint}\`
${agent.poolAddress ? `- Meteora pool: \`${agent.poolAddress}\`\n` : ""}- Live page: ${origin}/agent
` : ""}`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=300",
    },
  });
}
