import "server-only";

import { NextResponse } from "next/server";
import {
  describeArchiveError,
  getPremiumHistory,
  HISTORY_RANGES,
  type HistoryRange,
  type ObservationVenue,
} from "./archive";

const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

function isHistoryRange(value: string): value is HistoryRange {
  return Object.hasOwn(HISTORY_RANGES, value);
}

// Reads only the given venue's rows, so an arbitrary symbol can never
// surface another venue's asset.
export async function premiumHistoryResponse(
  venue: ObservationVenue,
  symbol: string,
  request: Request,
) {
  const range = new URL(request.url).searchParams.get("range") ?? "7d";

  if (!SYMBOL_PATTERN.test(symbol) || !isHistoryRange(range)) {
    return NextResponse.json(
      {
        error: "Unknown symbol or range",
        action: `Use a listed symbol and one of: ${Object.keys(HISTORY_RANGES).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  try {
    const history = await getPremiumHistory(venue, symbol, range);
    return NextResponse.json(
      { ...history.data, degradedReason: history.degradedReason },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (error) {
    console.error(`[FairPrint ${venue}] History read failed`, { symbol, range, error });
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
