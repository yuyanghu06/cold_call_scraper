import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTrackingCompanies } from "@/lib/services/attioService";
import { gateAttioRequest } from "@/lib/attio-unlock";
import {
  buildDashboardViewModel,
  type DashboardData,
  type DashboardPeriod,
} from "@/lib/viewmodels/dashboardViewModel";
import type { TrackingCompany } from "@/lib/viewmodels/trackingViewModel";

export type { DashboardData };
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const VALID_PERIODS: DashboardPeriod[] = ["today", "7d", "30d", "all"];

async function fetchAllCompanies(apiKey: string): Promise<TrackingCompany[]> {
  const all: TrackingCompany[] = [];
  let offset = 0;
  while (true) {
    const result = await listTrackingCompanies(apiKey, { limit: 500, offset });
    all.push(...result.companies);
    if (result.nextOffset === null || all.length >= 5000) break;
    offset = result.nextOffset;
  }
  return all;
}

export async function GET(req: Request) {
  const session = await auth();
  const gate = await gateAttioRequest(!!session?.user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(req.url);
  const rawPeriod = url.searchParams.get("period") ?? "all";
  const period: DashboardPeriod = VALID_PERIODS.includes(rawPeriod as DashboardPeriod)
    ? (rawPeriod as DashboardPeriod)
    : "all";
  const callerFilter = url.searchParams.get("caller") ?? null;

  try {
    const allCompanies = await fetchAllCompanies(gate.apiKey!);
    const filtered = callerFilter
      ? allCompanies.filter((c) => c.caller === callerFilter)
      : allCompanies;
    // Always derive callerNames from full dataset so filter buttons stay stable
    const callerNames = [
      ...new Map(
        allCompanies.filter((c) => c.caller).map((c) => [c.caller!, c.caller!])
      ).values(),
    ];
    const vm = buildDashboardViewModel(filtered, period);
    return NextResponse.json({ ...vm, callerNames });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
