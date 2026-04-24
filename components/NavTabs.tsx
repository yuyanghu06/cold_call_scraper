"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/", label: "Lead gen", match: (p) => p === "/" },
  { href: "/tracking", label: "Lead tracking", match: (p) => p.startsWith("/tracking") },
  { href: "/ingest", label: "Ingest existing", match: (p) => p.startsWith("/ingest") },
];

export default function NavTabs() {
  const pathname = usePathname() || "/";
  return (
    <nav className="flex items-baseline gap-1">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "text-[13px] font-medium tracking-tight text-neutral-900 px-3 pb-3 border-b-2 border-neutral-900 -mb-[1px]"
                : "text-[13px] tracking-tight text-neutral-500 hover:text-neutral-900 px-3 pb-3"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
