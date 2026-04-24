#!/usr/bin/env tsx
// List every attribute on Attio's Companies object along with its display
// name and API slug. Run this whenever an "unknown attribute slug" or
// "Cannot find attribute" error comes back — compare the slugs here against
// the SLUG constant in lib/attio.ts to find the mismatch.
//
// Usage:
//   npm run list-slugs                        (reads ATTIO_API_KEY from .env[.local])
//   ATTIO_API_KEY=<key> npm run list-slugs    (explicit override)

import "./_load-env";

const ATTIO_BASE = "https://api.attio.com/v2";

interface AttioAttribute {
  id?: unknown;
  api_slug?: string;
  title?: string;
  type?: string;
  is_archived?: boolean;
}

async function main(): Promise<void> {
  const apiKey = process.env.ATTIO_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.error("Error: ATTIO_API_KEY env var is not set.");
    console.error("Usage: ATTIO_API_KEY=<key> npm run list-slugs");
    process.exit(1);
  }

  const res = await fetch(`${ATTIO_BASE}/objects/companies/attributes`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Attio ${res.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const json = (await res.json()) as { data?: AttioAttribute[] };
  const attrs = (json.data ?? []).filter((a) => !a.is_archived);

  const maxTitle = Math.max(
    12,
    ...attrs.map((a) => (a.title ?? "").length),
  );
  const maxSlug = Math.max(
    8,
    ...attrs.map((a) => (a.api_slug ?? "").length),
  );

  console.log(
    `${"DISPLAY NAME".padEnd(maxTitle)}  ${"SLUG".padEnd(maxSlug)}  TYPE`,
  );
  console.log(
    `${"-".repeat(maxTitle)}  ${"-".repeat(maxSlug)}  ${"-".repeat(12)}`,
  );
  for (const attr of attrs) {
    console.log(
      `${(attr.title ?? "").padEnd(maxTitle)}  ${(attr.api_slug ?? "").padEnd(maxSlug)}  ${attr.type ?? ""}`,
    );
  }
  console.log(`\n${attrs.length} attribute${attrs.length === 1 ? "" : "s"}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
