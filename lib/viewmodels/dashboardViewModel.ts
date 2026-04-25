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

export interface CallsByHourRow {
  hour: string; // "9am", "10am" etc.
  total: number;
  [caller: string]: number | string;
}

export interface RecentCall {
  id: string;
  name: string | null;
  caller: string | null;
  callStatus: string | null;
  industry: string | null;
  callStatusUpdatedAt: string;
}

export interface IndustryInsightsData {
  rows: IndustryStats[];
  avgPickUpRate: number;
  avgWinRate: number;
}

export interface IndustryStats {
  industry: string;
  totalCalls: number;
  pickedUp: number;
  won: number;
  pickUpRate: number;
  winRate: number;
  deltaPickUp: number;
  deltaWin: number;
}

export interface RepStats {
  name: string;
  totalCalls: number;
  pickedUp: number;       // called and someone answered (not no pick up)
  positive: number;       // Interested + Demo Booked
  notInterested: number;
  noPickUp: number;
  pickUpRate: number;     // pickedUp / totalCalls
  winRate: number;        // positive / totalCalls
}

export interface TimeOfDayRow {
  hour: string;
  totalCalls: number;
  pickedUp: number;
  won: number;
  pickUpRate: number;
  winRate: number;
}

export interface DashboardData {
  total: number;
  byCallStatus: Array<{ name: string; count: number }>;
  byTerritory: Array<{ name: string; count: number }>;
  byIndustry: Array<{ name: string; count: number }>;
  byCaller: Array<{ name: string; count: number }>;
  callsByDay: CallsByDayRow[];
  callsByHour: CallsByHourRow[];
  recentCalls: RecentCall[];
  repLeaderboard: RepStats[];
  industryInsights: IndustryInsightsData;
  timeOfDay: TimeOfDayRow[];
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
    // For called records, filter by when the call happened
    // For uncalled records, filter by when the record was created
    const ts = c.callStatus && c.callStatus !== "Not called yet"
      ? (c.callStatusUpdatedAt ?? c.updatedAt ?? c.createdAt)
      : c.createdAt;
    if (!ts) return false;
    return new Date(ts) >= cutoff;
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
  // Only called records with a usable timestamp
  const called = companies.filter(
    (c) => c.caller && c.callStatus && c.callStatus !== "Not called yet" &&
      (c.callStatusUpdatedAt ?? c.updatedAt ?? c.createdAt),
  );

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
    const ts = c.callStatusUpdatedAt ?? c.updatedAt ?? c.createdAt!;
    const key = toDateKey(startOfDay(new Date(ts)));
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

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

function buildCallsByHour(
  companies: TrackingCompany[],
  callerNames: string[],
): CallsByHourRow[] {
  // Only include records that have been called and have an updatedAt timestamp
  const called = companies.filter(
    (c) => c.caller && c.updatedAt && c.callStatus && c.callStatus !== "Not called yet",
  );

  // Build rows for hours 7am–9pm
  const hours = Array.from({ length: 15 }, (_, i) => i + 7);
  const rows: CallsByHourRow[] = hours.map((h) => {
    const row: CallsByHourRow = { hour: formatHour(h), total: 0 };
    for (const name of callerNames) row[name] = 0;
    return row;
  });

  for (const c of called) {
    const h = new Date(c.updatedAt!).getHours();
    const rowIdx = h - 7;
    if (rowIdx < 0 || rowIdx >= rows.length) continue;
    const row = rows[rowIdx];
    row.total += 1;
    const rep = c.caller!;
    row[rep] = ((row[rep] as number) ?? 0) + 1;
  }

  return rows;
}

const POSITIVE_STATUSES = new Set(["Interested", "Demo Booked", "Connected"]);
const NO_PICK_UP_STATUSES = new Set(["No Pick Up", "Unknown", "Voicemail"]);

function buildTimeOfDay(companies: TrackingCompany[]): TimeOfDayRow[] {
  // Only use records with a real call timestamp — createdAt is when the lead
  // was added to Attio, not when the call happened, so it's not useful here.
  const called = companies.filter(
    (c) => c.callStatus && c.callStatus !== "Not called yet" && c.callStatusUpdatedAt,
  );

  const buckets = new Map<number, { total: number; pickedUp: number; won: number }>();
  for (let h = 7; h <= 21; h++) buckets.set(h, { total: 0, pickedUp: 0, won: 0 });

  for (const c of called) {
    const ts = c.callStatusUpdatedAt!;
    const h = new Date(ts).getHours();
    if (!buckets.has(h)) continue;
    const b = buckets.get(h)!;
    b.total++;
    if (!NO_PICK_UP_STATUSES.has(c.callStatus!)) b.pickedUp++;
    if (POSITIVE_STATUSES.has(c.callStatus!)) b.won++;
  }

  return [...buckets.entries()]
    .filter(([, b]) => b.total > 0)
    .map(([h, b]) => ({
      hour: h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`,
      totalCalls: b.total,
      pickedUp: b.pickedUp,
      won: b.won,
      pickUpRate: Math.round((b.pickedUp / b.total) * 100),
      winRate: Math.round((b.won / b.total) * 100),
    }));
}

function buildRepLeaderboard(companies: TrackingCompany[]): RepStats[] {
  const map = new Map<string, RepStats>();

  for (const c of companies) {
    if (!c.caller || !c.callStatus || c.callStatus === "Not called yet") continue;
    const rep = c.caller;
    if (!map.has(rep)) {
      map.set(rep, { name: rep, totalCalls: 0, pickedUp: 0, positive: 0, notInterested: 0, noPickUp: 0, pickUpRate: 0, winRate: 0 });
    }
    const s = map.get(rep)!;
    s.totalCalls++;
    if (POSITIVE_STATUSES.has(c.callStatus)) { s.pickedUp++; s.positive++; }
    else if (c.callStatus === "Not Interested" || c.callStatus === "No Decision Maker" || c.callStatus === "Callback later" || c.callStatus === "Send an email") { s.pickedUp++; if (c.callStatus === "Not Interested") s.notInterested++; }
    else if (NO_PICK_UP_STATUSES.has(c.callStatus)) { s.noPickUp++; }
    else { s.pickedUp++; } // any other status = picked up
  }

  return [...map.values()]
    .map((s) => ({
      ...s,
      pickUpRate: s.totalCalls > 0 ? Math.round((s.pickedUp / s.totalCalls) * 100) : 0,
      winRate: s.totalCalls > 0 ? Math.round((s.positive / s.totalCalls) * 100) : 0,
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls);
}

function normalizeIndustryLabel(raw: string | null): string {
  if (!raw) return "Unknown";
  const s = raw.trim().toLowerCase();
  // Known abbreviations stay uppercase
  if (s === "hvac") return "HVAC";
  if (s === "3pl") return "3PL";
  // Title-case everything else
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildIndustryInsights(companies: TrackingCompany[]): IndustryInsightsData {
  const called = companies.filter(
    (c) => c.callStatus && c.callStatus !== "Not called yet",
  );

  const map = new Map<string, { total: number; pickedUp: number; won: number }>();
  for (const c of called) {
    const key = normalizeIndustryLabel(c.industry);
    if (!map.has(key)) map.set(key, { total: 0, pickedUp: 0, won: 0 });
    const s = map.get(key)!;
    s.total++;
    if (!NO_PICK_UP_STATUSES.has(c.callStatus!)) s.pickedUp++;
    if (POSITIVE_STATUSES.has(c.callStatus!)) s.won++;
  }

  const rows = [...map.entries()].map(([industry, s]) => ({
    industry,
    totalCalls: s.total,
    pickedUp: s.pickedUp,
    won: s.won,
    pickUpRate: s.total > 0 ? Math.round((s.pickedUp / s.total) * 100) : 0,
    winRate: s.total > 0 ? Math.round((s.won / s.total) * 100) : 0,
    deltaPickUp: 0,
    deltaWin: 0,
  }));

  // Overall averages (weighted by call count)
  const totalAll = rows.reduce((s, r) => s + r.totalCalls, 0);
  const avgPickUp = totalAll > 0
    ? rows.reduce((s, r) => s + r.pickUpRate * r.totalCalls, 0) / totalAll
    : 0;
  const avgWin = totalAll > 0
    ? rows.reduce((s, r) => s + r.winRate * r.totalCalls, 0) / totalAll
    : 0;

  const sorted = rows
    .map((r) => ({
      ...r,
      deltaPickUp: Math.round(r.pickUpRate - avgPickUp),
      deltaWin: Math.round(r.winRate - avgWin),
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls);

  return {
    rows: sorted,
    avgPickUpRate: Math.round(avgPickUp),
    avgWinRate: Math.round(avgWin),
  };
}

function buildRecentCalls(companies: TrackingCompany[]): RecentCall[] {
  return companies
    .filter((c) => c.callStatus && c.callStatus !== "Not called yet")
    .map((c) => ({
      id: c.id,
      name: c.name,
      caller: c.caller,
      callStatus: c.callStatus,
      industry: c.industry,
      callStatusUpdatedAt: c.callStatusUpdatedAt ?? c.updatedAt ?? c.createdAt ?? "",
    }))
    .filter((c) => c.callStatusUpdatedAt)
    .sort((a, b) => new Date(b.callStatusUpdatedAt).getTime() - new Date(a.callStatusUpdatedAt).getTime())
    .slice(0, 100);
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
    callsByHour: buildCallsByHour(filtered, callerNames),
    recentCalls: buildRecentCalls(filtered),
    repLeaderboard: buildRepLeaderboard(filtered),
    industryInsights: buildIndustryInsights(filtered),
    timeOfDay: buildTimeOfDay(filtered),
    callerNames,
    sankey: buildSankey(countBy(filtered, "callStatus")),
    period,
  };
}
