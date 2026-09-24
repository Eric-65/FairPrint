import { NextResponse } from "next/server";
import { describeArchiveError, getLatestArchivedLiquidity } from "@/lib/archive";
import { measureMarkedTrade, parseTradeInputs } from "@/lib/marked-trade";
import { findTesseraSnapshot, isAllowedTesseraMint } from "@/lib/tessera";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;

  let snapshot: Awaited<ReturnType<typeof findTesseraSnapshot>>;
  try {
    snapshot = await findTesseraSnapshot(symbol);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Tessera measurement is unavailable",
        action: "Keep this page open and retry after the source reconnects.",
        detail: error instanceof Error ? error.message : "Tessera fetch failed",
      },
      { status: 503 },
    );
  }

  if (!snapshot) {
    return NextResponse.json(
      {
        error: "Token is not in the Tessera list",
        action: "Choose one of the T-Tokens from the Tessera watch.",
      },
      { status: 404 },
    );
  }

  // Quotes and depth probes only ever run against mints Tessera itself lists.
  if (!(await isAllowedTesseraMint(snapshot.token.mint))) {
    return NextResponse.json(
      {
        error: "Mint failed the Tessera allowlist check",
        action: "This token is no longer in the live Tessera response and cannot be quoted.",
      },
      { status: 403 },
    );
  }

  try {
    const { notionalUsd, tolerancePct } = parseTradeInputs(request);
    const comparisonSymbol = snapshot.comparison?.prestocks.symbol ?? null;
    const [trade, preStocksDepth] = await Promise.all([
      measureMarkedTrade({
        venue: "tessera",
        symbol: snapshot.token.symbol,
        mint: snapshot.token.mint,
        markPrice: snapshot.token.markPrice,
        premiumPct: snapshot.premiumPct,
        decimals: snapshot.tokenDecimals,
        notionalUsd,
        tolerancePct,
      }),
      // Archived only: the comparison never spends Jupiter quotes on another venue's mint.
      comparisonSymbol
        ? getLatestArchivedLiquidity("prestocks", [comparisonSymbol]).then(
            (result) => result.data.find((reading) => reading.symbol === comparisonSymbol) ?? null,
            (error: unknown) => {
              console.error("[FairPrint tessera] Comparison depth read failed", { error: describeArchiveError(error) });
              return null;
            },
          )
        : Promise.resolve(null),
    ]);

    return NextResponse.json(
      {
        snapshot,
        ...trade,
        comparisonDepth1PctUsd: preStocksDepth?.depth1PctUsd ?? null,
        notionalUsd,
        tolerancePct,
        measuredAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Live trade measurement is unavailable",
        action: "Keep this page open and retry after the source reconnects.",
        detail: error instanceof Error ? error.message : "Unknown upstream response",
      },
      { status: 503 },
    );
  }
}
