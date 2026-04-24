import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTrackingCompanies } from "@/lib/services/attioService";
import { gateAttioRequest } from "@/lib/attio-unlock";
import { buildDashboardViewModel, type DashboardData } from "@/lib/viewmodels/dashboardViewModel";
import type { TrackingCompany } from "@/lib/viewmodels/trackingViewModel";

export { type DashboardData };
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

export async function GET() {
  const session = await auth();
  const gate = await gateAttioRequest(!!session?.user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const companies = await fetchAllCompanies(gate.apiKey!);
    return NextResponse.json(buildDashboardViewModel(companies));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
