import { NextResponse } from "next/server";
import { agentTokenConfig, getAgentTokenReport } from "@/lib/agent-token";
import type { AgentStatusResponse } from "@/lib/agent-types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const config = agentTokenConfig();
  if (!config) {
    const body: AgentStatusResponse = { configured: false, quoteSymbol: process.env.AGENT_QUOTE_SYMBOL?.trim() || "TSLAx" };
    return NextResponse.json(body, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    const body: AgentStatusResponse = { configured: true, ...(await getAgentTokenReport(config)) };
    return NextResponse.json(body, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Agent token measurement is unavailable",
        action: "Keep this page open and retry after the source reconnects.",
        detail: error instanceof Error ? error.message : "Unknown upstream response",
      },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
