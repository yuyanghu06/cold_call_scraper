import type { TrackingCompany } from "@/lib/viewmodels/trackingViewModel";

export interface DashboardData {
  total: number;
  byCallStatus: Array<{ name: string; count: number }>;
  byTerritory: Array<{ name: string; count: number }>;
  byIndustry: Array<{ name: string; count: number }>;
}

function countBy(
  companies: TrackingCompany[],
  key: keyof TrackingCompany,
): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const c of companies) {
    const raw = c[key];
    const values: string[] = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === "string" && raw
        ? [raw]
        : ["Unknown"];
    for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

export function buildDashboardViewModel(companies: TrackingCompany[]): DashboardData {
  return {
    total: companies.length,
    byCallStatus: countBy(companies, "callStatus"),
    byTerritory: countBy(companies, "territory").slice(0, 12),
    byIndustry: countBy(companies, "industry").slice(0, 10),
  };
}
