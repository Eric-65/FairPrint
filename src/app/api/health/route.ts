export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    service: "fairprint",
    checkedAt: new Date().toISOString(),
  });
}
