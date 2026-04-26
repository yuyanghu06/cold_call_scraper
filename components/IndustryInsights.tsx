"use client";

import { useState, useMemo } from "react";
import type { IndustryInsightsData, IndustryStats } from "@/lib/viewmodels/dashboardViewModel";

type SortKey = keyof Pick<IndustryStats, "industry" | "totalCalls" | "pickUpRate" | "pickedUp" | "deltaPickUp" | "winRate" | "won" | "deltaWin">;
type SortDir = "asc" | "desc";

const ROW_HEIGHT = 49; // px per row
const VISIBLE_ROWS = 10;

// Interpolate from neutral gray → green based on 0–100 scale
function rateColor(pct: number): string {
  return pct >= 50 ? "#22c55e" : "#ef4444";
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-neutral-300 tabular-nums text-[12px]">—</span>;
  const pos = value > 0;
  return (
    <span className={`tabular-nums font-medium text-[12px] ${pos ? "text-green-500" : "text-red-400"}`}>
      {pos ? "+" : ""}{value}%
    </span>
  );
}

function RateBar({ rate, color }: { rate: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="tabular-nums text-[13px] text-neutral-800 w-9 text-right shrink-0">{rate}%</span>
      <div className="flex-1 bg-neutral-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${rate}%`, background: color }} />
      </div>
    </div>
  );
}

function RawCount({ raw, total }: { raw: number; total: number }) {
  return (
    <span className="tabular-nums text-[12px] text-neutral-700 whitespace-nowrap">
      {raw}<span className="text-neutral-400">/{total}</span>
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="ml-1 inline-flex flex-col gap-[2px]" style={{ opacity: active ? 1 : 0.3 }}>
      <span className={`block w-0 h-0 border-l-[3px] border-r-[3px] border-b-[4px] border-l-transparent border-r-transparent ${active && dir === "asc" ? "border-b-neutral-900" : "border-b-neutral-400"}`} />
      <span className={`block w-0 h-0 border-l-[3px] border-r-[3px] border-t-[4px] border-l-transparent border-r-transparent ${active && dir === "desc" ? "border-t-neutral-900" : "border-t-neutral-400"}`} />
    </span>
  );
}

interface Props {
  insights: IndustryInsightsData;
}

export default function IndustryInsights({ insights }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalCalls");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { rows, avgPickUpRate, avgWinRate } = insights;

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "industry" ? "asc" : "desc"); }
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  }), [rows, sortKey, sortDir]);

  if (rows.length === 0) return null;

  function ColHeader({ label, sortK, right }: { label: string; sortK: SortKey; right?: boolean }) {
    return (
      <th
        onClick={() => handleSort(sortK)}
        className={`px-4 py-2.5 text-[11px] uppercase tracking-widest text-neutral-400 font-normal cursor-pointer select-none hover:text-neutral-700 whitespace-nowrap ${right ? "text-right" : "text-left"}`}
      >
        <span className="inline-flex items-center gap-0.5">
          {label}
          <SortIcon active={sortKey === sortK} dir={sortDir} />
        </span>
      </th>
    );
  }

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100">
        <span className="text-[13px] font-medium">Industry insights</span>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS + 41 }}>
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-neutral-100 bg-neutral-50 text-left">
              <ColHeader label="Industry" sortK="industry" />
              <ColHeader label="Calls" sortK="totalCalls" right />
              <ColHeader label="Pick-up rate" sortK="pickUpRate" />
              <th onClick={() => handleSort("deltaPickUp")}
                className="px-4 py-2.5 text-[11px] uppercase tracking-widest text-neutral-400 font-normal cursor-pointer select-none hover:text-neutral-700 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Δ avg <span className="text-black normal-case font-bold">({avgPickUpRate}%)</span>
                  <SortIcon active={sortKey === "deltaPickUp"} dir={sortDir} />
                </span>
              </th>
              <ColHeader label="Picked up" sortK="pickedUp" />
              <ColHeader label="Win rate" sortK="winRate" />
              <th onClick={() => handleSort("deltaWin")}
                className="px-4 py-2.5 text-[11px] uppercase tracking-widest text-neutral-400 font-normal cursor-pointer select-none hover:text-neutral-700 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Δ avg <span className="text-black normal-case font-bold">({avgWinRate}%)</span>
                  <SortIcon active={sortKey === "deltaWin"} dir={sortDir} />
                </span>
              </th>
              <ColHeader label="Won" sortK="won" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sorted.map((row) => (
              <tr key={row.industry} className="hover:bg-neutral-50 transition-colors">
                <td className="px-5 py-3 font-medium">{row.industry}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{row.totalCalls.toLocaleString()}</td>
                <td className="px-4 py-3"><RateBar rate={row.pickUpRate} color="#60a5fa" /></td>
                <td className="px-4 py-3"><Delta value={row.deltaPickUp} /></td>
                <td className="px-4 py-3"><RawCount raw={row.pickedUp} total={row.totalCalls} /></td>
                <td className="px-4 py-3"><RateBar rate={row.winRate} color="#22c55e" /></td>
                <td className="px-4 py-3"><Delta value={row.deltaWin} /></td>
                <td className="px-5 py-3"><RawCount raw={row.won} total={row.totalCalls} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
