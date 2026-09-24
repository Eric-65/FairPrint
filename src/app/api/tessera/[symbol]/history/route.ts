import { premiumHistoryResponse } from "@/lib/history-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await context.params;
  return premiumHistoryResponse("tessera", symbol, request);
}
