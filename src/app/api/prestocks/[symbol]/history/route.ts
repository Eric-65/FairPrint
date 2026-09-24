import { NextResponse } from "next/server";
import {
  describeArchiveError,
  getPremiumHistory,
  HISTORY_RANGES,
  type HistoryRange,
} from "@/lib/archive";

export const dynamic = "force-dynamic";

const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

function isHistoryRange(value: string): value is HistoryRange {
  return Object.hasOwn(HISTORY_RANGES, value);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  const range = new URL(request.url).searchParams.get("range") ?? "7d";

  if (!SYMBOL_PATTERN.test(symbol) || !isHistoryRange(range)) {
    return NextResponse.json(
      {
        error: "Unknown symbol or range",
        action: `Use a PreStocks symbol and one of: ${Object.keys(HISTORY_RANGES).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  try {
    // Only venue = 'prestocks' rows are read, so this can never surface
    // another venue's asset even for an arbitrary symbol.
    const history = await getPremiumHistory("prestocks", symbol, range);
    return NextResponse.json(
      { ...history.data, degradedReason: history.degradedReason },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error("[FairPrint prestocks] History read failed", { symbol, range, error });
    return NextResponse.json(
      {
        error: "Premium history is unavailable",
        action: "Retry in a minute.",
        detail: describeArchiveError(error),
      },
      { status: 503 },
    );
  }
}
