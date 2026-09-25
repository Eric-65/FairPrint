export type Section = "xstocks" | "prestocks" | "tessera";

const ALL_SECTIONS: readonly Section[] = ["xstocks", "prestocks", "tessera"];

export const SECTION_HOME: Record<Section, string> = {
  xstocks: "/",
  prestocks: "/prestocks",
  tessera: "/tessera",
};

export const SECTION_LABEL: Record<Section, string> = {
  xstocks: "xStocks",
  prestocks: "PreStocks",
  tessera: "Tessera",
};

function isSection(value: string): value is Section {
  return (ALL_SECTIONS as readonly string[]).includes(value);
}

// FAIRPRINT_SECTIONS picks which venues a deployment shows, so one codebase
// can be submitted separately to bounties that each require their own venue
// only (e.g. "xstocks,prestocks" for one deployment, "tessera" for another).
// Unset or unrecognized means every section.
export function enabledSections(): Section[] {
  const picked = (process.env.FAIRPRINT_SECTIONS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(isSection);
  return picked.length > 0 ? [...new Set(picked)] : [...ALL_SECTIONS];
}

export function sectionForPath(pathname: string): Section | null {
  if (pathname === "/" || pathname.startsWith("/t/") || pathname.startsWith("/api/market")) return "xstocks";
  if (pathname === "/prestocks" || pathname.startsWith("/prestocks/") || pathname.startsWith("/api/prestocks")) {
    return "prestocks";
  }
  if (pathname === "/tessera" || pathname.startsWith("/tessera/") || pathname.startsWith("/api/tessera")) {
    return "tessera";
  }
  return null;
}
