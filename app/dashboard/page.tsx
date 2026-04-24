"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { DashboardData } from "@/app/api/dashboard/route";

const STATUS_COLORS: Record<string, string> = {
  "Not called yet": "#e5e7eb",
  "No answer": "#fbbf24",
  "Left voicemail": "#60a5fa",
  "Connected": "#34d399",
  "Not interested": "#f87171",
  "Follow up": "#a78bfa",
  "Unknown": "#d1d5db",
};

const TERRITORY_COLOR = "#1a1a1a";
const INDUSTRY_COLOR = "#525252";

const PIE_FALLBACK_COLORS = [
  "#1a1a1a", "#404040", "#737373", "#a3a3a3",
  "#d4d4d4", "#fbbf24", "#60a5fa", "#34d399",
  "#f87171", "#a78bfa",
];

function statusColor(name: string, idx: number): string {
  return STATUS_COLORS[name] ?? PIE_FALLBACK_COLORS[idx % PIE_FALLBACK_COLORS.length];
}

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="border border-neutral-200 rounded-lg px-5 py-4">
      <div className="text-[11px] uppercase tracking-widest text-neutral-400 mb-1">
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight">{value}</div>
      {sub && (
        <div className="text-[12px] text-neutral-400 mt-1">{sub}</div>
      )}
    </div>
  );
}

// Custom tooltip for bar charts
function BarTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded px-3 py-2 text-sm shadow-sm">
      <div className="font-medium">{label}</div>
      <div className="text-neutral-500">{payload[0].value} companies</div>
    </div>
  );
}

function PieTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded px-3 py-2 text-sm shadow-sm">
      <div className="font-medium">{payload[0].name}</div>
      <div className="text-neutral-500">{payload[0].value} companies</div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d: DashboardData & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load")
      )
      .finally(() => setLoading(false));
  }, []);

  // Derive quick stats from byCallStatus
  const called = data
    ? data.byCallStatus
        .filter((s) => s.name !== "Not called yet" && s.name !== "Unknown")
        .reduce((sum, s) => sum + s.count, 0)
    : null;

  const connected = data
    ? (data.byCallStatus.find((s) => s.name === "Connected")?.count ?? 0)
    : null;

  const notCalled = data
    ? (data.byCallStatus.find((s) => s.name === "Not called yet")?.count ?? 0)
    : null;

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-neutral-400 mt-0.5">Live from Attio CRM</p>
      </div>

      {loading && (
        <div className="text-sm text-neutral-400">Loading…</div>
      )}

      {error && (
        <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-8">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total in CRM"
              value={data.total.toLocaleString()}
            />
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
              label="Connected"
              value={(connected ?? 0).toLocaleString()}
              sub={called ? `${Math.round(((connected ?? 0) / called) * 100)}% connect rate` : undefined}
            />
          </div>

          {/* Call status + territory */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Call status donut */}
            <div className="border border-neutral-200 rounded-lg p-5">
              <div className="text-[13px] font-medium mb-4">By call status</div>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={data.byCallStatus}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                  >
                    {data.byCallStatus.map((entry, i) => (
                      <Cell key={entry.name} fill={statusColor(entry.name, i)} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => (
                      <span className="text-[12px] text-neutral-600">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Territory bar */}
            <div className="border border-neutral-200 rounded-lg p-5">
              <div className="text-[13px] font-medium mb-4">By territory (top 12)</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.byTerritory}
                  layout="vertical"
                  margin={{ left: 8, right: 16, top: 0, bottom: 0 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: "#f5f5f5" }} />
                  <Bar dataKey="count" fill={TERRITORY_COLOR} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Industry bar */}
          {data.byIndustry.length > 0 && (
            <div className="border border-neutral-200 rounded-lg p-5">
              <div className="text-[13px] font-medium mb-4">By industry (top 10)</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={data.byIndustry}
                  margin={{ left: 8, right: 16, top: 0, bottom: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={48}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<BarTooltip />} cursor={{ fill: "#f5f5f5" }} />
                  <Bar dataKey="count" fill={INDUSTRY_COLOR} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
