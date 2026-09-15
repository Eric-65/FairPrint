import { NextResponse } from "next/server";
import { rollupDailyStats } from "@/lib/archive";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authorization = authorizeCron(request);
  if (!authorization.authorized) {
    return NextResponse.json(authorization.body, {
      status: authorization.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const requestedDate = new URL(request.url).searchParams.get("date") ?? undefined;
  try {
    const summary = await rollupDailyStats(requestedDate);
    console.info("[FairPrint archive] Daily rollup complete", summary);
    return NextResponse.json(
      { ok: true, ...summary },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown rollup error";
    console.error("[FairPrint archive] Daily rollup failed", { error });
    return NextResponse.json(
      {
        error: "Daily rollup failed",
        action: "Verify the requested date and database connection, then rerun the rollup.",
        detail,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
