import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTrackingCompanies, normalizeTerritory } from "@/lib/attio";
import { gateAttioRequest } from "@/lib/attio-unlock";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Accept either repeated params (?k=a&k=b) or comma-separated (?k=a,b). Comma
// is fine here because every option value (US state names, Attio select
// titles) is comma-free.
function readList(params: URLSearchParams, key: string): string[] {
  const all = params.getAll(key);
  const out: string[] = [];
  for (const v of all) {
    for (const part of v.split(",")) {
      const trimmed = part.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

export async function GET(req: Request) {
  const session = await auth();
  const gate = await gateAttioRequest(!!session?.user);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const url = new URL(req.url);
  const territoryRaw = readList(url.searchParams, "territory");
  const callStatusRaw = readList(url.searchParams, "callStatus");
  const industryRaw = readList(url.searchParams, "industry");
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");

  // Territory values may come in as full state names or 2-letter abbrs
  // depending on where they originated. Normalize every value so Attio's
  // filter matches whatever the CRM has stored.
  const territory = territoryRaw.map(normalizeTerritory);
  const callStatus = callStatusRaw;
  const industry = industryRaw;
  const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw))) : 100;
  const offset = offsetRaw ? Math.max(0, Number(offsetRaw)) : 0;

  try {
    const result = await listTrackingCompanies(gate.apiKey!, {
      territory,
      callStatus,
      industry,
      limit,
      offset,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
