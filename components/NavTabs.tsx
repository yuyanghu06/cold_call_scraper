"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/dashboard", label: "Dashboard", match: (p) => p.startsWith("/dashboard") },
  { href: "/leadgen", label: "Lead gen", match: (p) => p.startsWith("/leadgen") },
  { href: "/tracking", label: "Lead tracking", match: (p) => p.startsWith("/tracking") },
  { href: "/ingest", label: "Ingest existing", match: (p) => p.startsWith("/ingest") },
];

export default function NavTabs() {
  const pathname = usePathname() || "/dashboard";
  return (
    <nav className="flex flex-col gap-0.5">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "text-[13px] font-medium tracking-tight text-neutral-900 bg-neutral-100 rounded px-2.5 py-1.5"
                : "text-[13px] tracking-tight text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 rounded px-2.5 py-1.5"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
