import Link from "next/link";
import { enabledSections, SECTION_HOME, SECTION_LABEL, type Section } from "@/lib/sections";

export function SectionNav({ current }: { current: Section }) {
  const sections = enabledSections();
  if (sections.length < 2) return null;

  return (
    <nav className="site-head__nav" aria-label="Sections">
      {sections.map((section) => (
        <Link
          key={section}
          href={SECTION_HOME[section]}
          aria-current={section === current ? "page" : undefined}
        >
          {SECTION_LABEL[section]}
        </Link>
      ))}
    </nav>
  );
}
