"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Sankey,
  Rectangle,
} from "recharts";
import type { DashboardData, DashboardPeriod } from "@/lib/viewmodels/dashboardViewModel";

// Semantic colors for known outcomes
const SANKEY_COLORS: Record<string, string> = {
  "Called":            "#1a1a1a",
  "Interested":        "#22c55e",
  "Not Interested":    "#ef4444",
  "No Decision Maker": "#94a3b8",
  "No Pick Up":        "#64748b",
  "Callback later":    "#3b82f6",
  "Send an email":     "#8b5cf6",
  "Unknown":           "#d1d5db",
  "Voicemail":         "#a78bfa",
  "Connected":         "#22c55e",
};

// Clean neutral palette for any unknown statuses
const SANKEY_PALETTE = [
  "#60a5fa", "#f97316", "#a855f7", "#14b8a6",
  "#f59e0b", "#ec4899", "#06b6d4", "#84cc16",
];

const sankeyColorCache = new Map<string, string>();
let paletteIdx = 0;

function sankeyColor(name: string): string {
  if (SANKEY_COLORS[name]) return SANKEY_COLORS[name];
  if (sankeyColorCache.has(name)) return sankeyColorCache.get(name)!;
  const color = SANKEY_PALETTE[paletteIdx % SANKEY_PALETTE.length];
  paletteIdx++;
  sankeyColorCache.set(name, color);
  return color;
}

const REP_COLORS = [
  "#1a1a1a", "#60a5fa", "#34d399", "#fbbf24",
  "#f87171", "#a78bfa", "#fb923c", "#38bdf8",
];

const PERIODS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function repColor(idx: number): string {
  return REP_COLORS[idx % REP_COLORS.length];
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="border border-neutral-200 rounded-lg px-4 py-3 flex items-center gap-4">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div>
        <div className="text-[11px] uppercase tracking-widest text-neutral-400 leading-tight">{label}</div>
        {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function BarTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; fill: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-neutral-200 rounded px-3 py-2 text-sm shadow-sm min-w-[140px]">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-neutral-600">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.fill }} />
            {p.name}
          </span>
          <span className="font-medium">{p.value}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="flex justify-between mt-1 pt-1 border-t border-neutral-100 text-neutral-500">
          <span>Total</span><span className="font-medium">{total}</span>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>("7d");
  const [caller, setCaller] = useState<string | null>(null);
  const [allCallerNames, setAllCallerNames] = useState<string[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((p: DashboardPeriod, c: string | null) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ period: p });
    if (c) params.set("caller", c);
    fetch(`/api/dashboard?${params}`)
      .then((r) => r.json())
      .then((d: DashboardData & { callerNames?: string[]; error?: string }) => {
        if (d.error) setError(d.error);
        else {
          setData(d);
          if (d.callerNames?.length) setAllCallerNames(d.callerNames);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(period, caller); }, [load, period, caller]);

  function selectPeriod(p: DashboardPeriod) {
    setPeriod(p);
    load(p, caller);
  }

  function selectCaller(c: string | null) {
    setCaller(c);
    load(period, c);
  }

  const called = data
    ? data.byCallStatus.filter((s) => s.name !== "Not called yet" && s.name !== "Unknown").reduce((sum, s) => sum + s.count, 0)
    : null;
  const connected = data ? (data.byCallStatus.find((s) => s.name === "Connected")?.count ?? 0) : null;
  const notCalled = data ? (data.byCallStatus.find((s) => s.name === "Not called yet")?.count ?? 0) : null;
  const totalCallsInPeriod = data?.byCaller.reduce((s, r) => s + r.count, 0) ?? 0;
  const avgPerDay = data
    ? period === "today" ? totalCallsInPeriod
      : period === "7d" ? Math.round((totalCallsInPeriod / 7) * 10) / 10
      : period === "30d" ? Math.round((totalCallsInPeriod / 30) * 10) / 10
      : null
    : null;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      {/* Header + period filters */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-neutral-400 mt-0.5">Live from Attio CRM</p>
        </div>
        <div className="flex items-center gap-1 bg-neutral-100 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => selectPeriod(p.value)}
              className={
                period === p.value
                  ? "text-[12px] font-medium px-3 py-1.5 rounded-md bg-white shadow-sm text-neutral-900"
                  : "text-[12px] px-3 py-1.5 rounded-md text-neutral-500 hover:text-neutral-700"
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Caller filter */}
      {allCallerNames.length > 0 && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-[11px] uppercase tracking-widest text-neutral-400 mr-1">Rep</span>
          <button
            onClick={() => selectCaller(null)}
            className={caller === null
              ? "text-[12px] font-medium px-3 py-1 rounded-full bg-neutral-900 text-white"
              : "text-[12px] px-3 py-1 rounded-full border border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400"}
          >
            All
          </button>
          {allCallerNames.map((name, i) => (
            <button
              key={name}
              onClick={() => selectCaller(name)}
              className={caller === name
                ? "text-[12px] font-medium px-3 py-1 rounded-full text-white"
                : "text-[12px] px-3 py-1 rounded-full border border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400"}
              style={caller === name ? { background: repColor(i) } : undefined}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded px-4 py-3 mb-6">
          {error}
        </div>
      )}

      {loading && !data && <div className="text-sm text-neutral-400">Loading…</div>}

      {data && (
        <div className={`flex flex-col gap-8 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>

          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total in CRM" value={data.total.toLocaleString()} />
            <StatCard
              label="Not called yet"
              value={(notCalled ?? 0).toLocaleString()}
              sub={data.total ? `${Math.round(((notCalled ?? 0) / data.total) * 100)}% of total` : undefined}
            />
            <StatCard
              label="Called"
              value={(called ?? 0).toLocaleString()}
              sub={data.total ? `${Math.round(((called ?? 0) / data.total) * 100)}% of total` : undefined}
            />
            <StatCard
              label={period === "today" ? "Calls today" : period === "all" ? "Connected" : "Avg calls / day"}
              value={period === "today" || period === "all"
                ? (connected ?? 0).toLocaleString()
                : avgPerDay !== null ? avgPerDay : "—"}
              sub={called && period === "all" ? `${Math.round(((connected ?? 0) / called) * 100)}% connect rate` : undefined}
            />
          </div>

          {/* Sankey: lead flow */}
          {data.sankey.nodes.length > 0 && (
            <div className="border border-neutral-200 rounded-lg p-5">
              <div className="text-[13px] font-medium mb-4">Lead flow</div>
              <ResponsiveContainer width="100%" height={Math.max(480, data.sankey.nodes.length * 58)}>
                <Sankey
                  data={data.sankey}
                  nodePadding={14}
                  nodeWidth={12}
                  link={(props: { sourceX?: number; sourceY?: number; sourceControlX?: number; targetX?: number; targetY?: number; targetControlX?: number; linkWidth?: number; index?: number }) => {
                    const { sourceX = 0, sourceY = 0, sourceControlX = 0, targetX = 0, targetY = 0, targetControlX = 0, linkWidth = 0, index = 0 } = props;
                    const link = data.sankey.links[index];
                    const targetNode = data.sankey.nodes[link?.target ?? 0];
                    const color = sankeyColor(targetNode?.name ?? "");
                    return (
                      <path
                        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={linkWidth}
                        strokeOpacity={0.15}
                      />
                    );
                  }}
                  node={(props: {
                    x?: number; y?: number; width?: number; height?: number;
                    index?: number; payload?: { name?: string; value?: number };
                  }) => {
                    const { x = 0, y = 0, width = 0, height = 0, index = 0, payload } = props;
                    const name = payload?.name ?? "";
                    const value = payload?.value ?? 0;
                    const color = sankeyColor(name);
                    const isLeft = x < 200;

                    // % relative to parent step
                    const incomingLink = data.sankey.links.find((l) => l.target === index);
                    let pct: string | null = null;
                    if (incomingLink) {
                      const parentTotal = data.sankey.links
                        .filter((l) => l.source === incomingLink.source)
                        .reduce((s, l) => s + l.value, 0);
                      if (parentTotal > 0) pct = `${Math.round((value / parentTotal) * 100)}%`;
                    }

                    return (
                      <g>
                        <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.9} radius={3} />
                        <text
                          x={isLeft ? x + width + 10 : x - 10}
                          y={y + height / 2 - (pct ? 9 : 0)}
                          textAnchor={isLeft ? "start" : "end"}
                          dominantBaseline="middle"
                          fill="#111827"
                          fontSize={13}
                          fontWeight={600}
                        >
                          {name}
                        </text>
                        <text
                          x={isLeft ? x + width + 10 : x - 10}
                          y={y + height / 2 + 9}
                          textAnchor={isLeft ? "start" : "end"}
                          dominantBaseline="middle"
                          fill="#6b7280"
                          fontSize={12}
                          fontWeight={600}
                        >
                          {value.toLocaleString()}{pct ? ` · ${pct}` : ""}
                        </text>
                      </g>
                    );
                  }}
                />
              </ResponsiveContainer>
            </div>
          )}

          {/* Calls per day by rep */}
          <div className="border border-neutral-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] font-medium">Calls per day</div>
              <div className="flex items-center gap-3">
                {data.callerNames.map((name, i) => (
                  <span key={name} className="flex items-center gap-1.5 text-[12px] text-neutral-500">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: repColor(i) }} />
                    {name}
                  </span>
                ))}
              </div>
            </div>
            {data.callerNames.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-sm text-neutral-400">
                No caller data yet — make sure the Caller field is filled in Attio
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.callsByDay} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: "#f5f5f5" }} />
                  {data.callerNames.map((name, i) => (
                    <Bar key={name} dataKey={name} stackId="a" fill={repColor(i)} radius={i === data.callerNames.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>


        </div>
      )}
    </main>
  );
}
