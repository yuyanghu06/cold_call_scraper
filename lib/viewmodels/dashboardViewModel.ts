import type { TrackingCompany } from "@/lib/viewmodels/trackingViewModel";

export type DashboardPeriod = "today" | "7d" | "30d" | "all";

export interface CallsByDayRow {
  date: string;
  total: number;
  [caller: string]: number | string;
}

export interface SankeyNode {
  name: string;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface DashboardData {
  total: number;
  byCallStatus: Array<{ name: string; count: number }>;
  byTerritory: Array<{ name: string; count: number }>;
  byIndustry: Array<{ name: string; count: number }>;
  byCaller: Array<{ name: string; count: number }>;
  callsByDay: CallsByDayRow[];
  callerNames: string[];
  sankey: SankeyData;
  period: DashboardPeriod;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10); // "2026-04-24"
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function filterByPeriod(
  companies: TrackingCompany[],
  period: DashboardPeriod,
): TrackingCompany[] {
  if (period === "all") return companies;

  const now = new Date();
  let cutoff: Date;
  if (period === "today") {
    cutoff = startOfDay(now);
  } else if (period === "7d") {
    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return companies.filter((c) => {
    if (!c.createdAt) return false;
    return new Date(c.createdAt) >= cutoff;
  });
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

function buildCallsByDay(
  companies: TrackingCompany[],
  period: DashboardPeriod,
): { rows: CallsByDayRow[]; callerNames: string[] } {
  // Only include records that have actually been called (caller is set)
  const called = companies.filter((c) => c.caller && c.createdAt);

  // Collect all unique caller names (sorted by total desc)
  const callerTotals = new Map<string, number>();
  for (const c of called) {
    const rep = c.caller!;
    callerTotals.set(rep, (callerTotals.get(rep) ?? 0) + 1);
  }
  const callerNames = [...callerTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // Build the date range to display
  const now = new Date();
  const days =
    period === "today" ? 1
    : period === "7d" ? 7
    : period === "30d" ? 30
    : 30; // "all" → show last 30 days

  const dateKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    dateKeys.push(toDateKey(startOfDay(d)));
  }

  // Group by date + caller
  const grid = new Map<string, Map<string, number>>();
  for (const key of dateKeys) grid.set(key, new Map());

  for (const c of called) {
    const key = toDateKey(startOfDay(new Date(c.createdAt!)));
    if (!grid.has(key)) continue; // outside the window
    const dayMap = grid.get(key)!;
    const rep = c.caller!;
    dayMap.set(rep, (dayMap.get(rep) ?? 0) + 1);
  }

  const rows: CallsByDayRow[] = dateKeys.map((key) => {
    const dayMap = grid.get(key)!;
    const row: CallsByDayRow = { date: formatDateLabel(key), total: 0 };
    for (const rep of callerNames) {
      const n = dayMap.get(rep) ?? 0;
      row[rep] = n;
      row.total += n;
    }
    return row;
  });

  return { rows, callerNames };
}

function buildSankey(byCallStatus: Array<{ name: string; count: number }>): SankeyData {
  const outcomes = byCallStatus.filter((s) => s.name !== "Not called yet" && s.count > 0);
  const calledCount = outcomes.reduce((s, o) => s + o.count, 0);

  if (calledCount === 0) return { nodes: [], links: [] };

  // Node 0: Called (root), nodes 1+: outcomes
  const nodes: SankeyNode[] = [
    { name: "Called" },
    ...outcomes.map((o) => ({ name: o.name })),
  ];

  const links: SankeyLink[] = outcomes.map((o, i) => ({
    source: 0,
    target: i + 1,
    value: o.count,
  }));

  return { nodes, links };
}

export function buildDashboardViewModel(
  companies: TrackingCompany[],
  period: DashboardPeriod = "all",
): DashboardData {
  const filtered = filterByPeriod(companies, period);
  const { rows: callsByDay, callerNames } = buildCallsByDay(filtered, period);

  return {
    total: filtered.length,
    byCallStatus: countBy(filtered, "callStatus"),
    byTerritory: countBy(filtered, "territory").slice(0, 12),
    byIndustry: countBy(filtered, "industry").slice(0, 10),
    byCaller: countBy(filtered, "caller").filter((r) => r.name !== "Unknown"),
    callsByDay,
    callerNames,
    sankey: buildSankey(countBy(filtered, "callStatus")),
    period,
  };
}
