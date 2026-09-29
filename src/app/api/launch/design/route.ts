import { NextResponse } from "next/server";
import { designStockCurve, parseDesignInput } from "@/lib/dbc-designer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const input = parseDesignInput(new URL(request.url));
  try {
    const design = await designStockCurve(input);
    return NextResponse.json(design, {
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "The curve could not be designed",
        action: "Check that both legs have a live reference price, then try again.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
