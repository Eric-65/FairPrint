import { NextResponse } from "next/server";
import { getDbcPoolReport, isPoolAddress } from "@/lib/dbc-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;
  if (!isPoolAddress(address)) {
    return NextResponse.json(
      { error: "Not a Solana address", action: "Paste the DBC pool (virtual pool) address from Solscan or Meteora." },
      { status: 400, headers: CORS },
    );
  }

  try {
    const report = await getDbcPoolReport(address, new URL(request.url).searchParams.get("ref"));
    if (!report) {
      return NextResponse.json(
        { error: "No DBC pool at this address", action: "Check that it is a Meteora Dynamic Bonding Curve pool, not a token mint or DAMM pool." },
        { status: 404, headers: CORS },
      );
    }
    return NextResponse.json(report, {
      headers: { ...CORS, "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "The pool could not be read",
        action: "Solana RPC may be rate limiting; retry in a moment.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503, headers: CORS },
    );
  }
}
