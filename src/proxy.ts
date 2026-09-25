import { NextResponse, type NextRequest } from "next/server";
import { enabledSections, SECTION_HOME, sectionForPath } from "@/lib/sections";

// Hides every page and API route of a section this deployment doesn't enable.
// The observe cron is deliberately not gated: one deployment can archive all
// venues into the shared database that the others read.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const section = sectionForPath(pathname);
  const enabled = enabledSections();
  if (!section || enabled.includes(section)) return NextResponse.next();

  if (pathname === "/") {
    return NextResponse.redirect(new URL(SECTION_HOME[enabled[0]], request.url));
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not found", action: "This section is not part of this deployment." },
      { status: 404 },
    );
  }
  return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

export const config = {
  matcher: [
    "/",
    "/t/:path*",
    "/prestocks/:path*",
    "/tessera/:path*",
    "/api/market/:path*",
    "/api/prestocks/:path*",
    "/api/tessera/:path*",
    "/agent",
    "/api/agent/:path*",
    "/skill.md",
  ],
};
