import { NextResponse } from "next/server";
import { recordObservations } from "@/lib/archive";
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

  const startedAt = Date.now();
  try {
    const summary = await recordObservations();
    console.info("[FairPrint archive] Observation run complete", {
      ...summary,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: true,
        ...summary,
        durationMs: Date.now() - startedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[FairPrint archive] Observation run failed", { error });
    return NextResponse.json(
      {
        error: "Observation run failed before the archive was complete",
        action: "Inspect the server log, correct the failing database or source, then retry this minute.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
