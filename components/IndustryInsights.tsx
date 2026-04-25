"use client";

import { useState, useMemo } from "react";
import type { IndustryInsightsData, IndustryStats } from "@/lib/viewmodels/dashboardViewModel";

type SortKey = keyof Pick<IndustryStats, "industry" | "totalCalls" | "pickUpRate" | "deltaPickUp" | "winRate" | "deltaWin">;
type SortDir = "asc" | "desc";

const ROW_HEIGHT = 49; // px per row
const VISIBLE_ROWS = 10;

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-neutral-300 tabular-nums text-[12px]">—</span>;
  const pos = value > 0;
  return (
    <span className={`tabular-nums font-medium text-[12px] ${pos ? "text-green-500" : "text-red-400"}`}>
      {pos ? "+" : ""}{value}%
    </span>
  );
}

function RateCell({ rate, raw, total, color }: { rate: number; raw: number; total: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="tabular-nums text-[13px] w-9 text-right shrink-0">{rate}%</span>
      <div className="flex-1 bg-neutral-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${rate}%`, background: color }} />
      </div>
      <span className="tabular-nums text-[11px] text-neutral-400 shrink-0 whitespace-nowrap">{raw}/{total}</span>
    </div>
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
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
        <span className="text-[13px] font-medium">Industry insights</span>
        <div className="flex items-center gap-5 text-[12px] text-neutral-500">
          <span>Avg pick-up <span className="font-semibold text-neutral-800 tabular-nums">{avgPickUpRate}%</span></span>
          <span>Avg win rate <span className="font-semibold text-neutral-800 tabular-nums">{avgWinRate}%</span></span>
        </div>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS + 41 }}>
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-neutral-100 bg-neutral-50 text-left">
              <ColHeader label="Industry" sortK="industry" />
              <ColHeader label="Calls" sortK="totalCalls" right />
              <th className="px-4 py-2.5 text-[11px] uppercase tracking-widest text-neutral-400 font-normal w-52">Pick-up rate</th>
              <ColHeader label="Δ avg" sortK="deltaPickUp" />
              <th className="px-4 py-2.5 text-[11px] uppercase tracking-widest text-neutral-400 font-normal w-52">Win rate</th>
              <ColHeader label="Δ avg" sortK="deltaWin" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sorted.map((row) => (
              <tr key={row.industry} className="hover:bg-neutral-50 transition-colors">
                <td className="px-5 py-3 font-medium">{row.industry}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{row.totalCalls.toLocaleString()}</td>
                <td className="px-4 py-3"><RateCell rate={row.pickUpRate} raw={row.pickedUp} total={row.totalCalls} color="#60a5fa" /></td>
                <td className="px-4 py-3"><Delta value={row.deltaPickUp} /></td>
                <td className="px-4 py-3"><RateCell rate={row.winRate} raw={row.won} total={row.totalCalls} color="#22c55e" /></td>
                <td className="px-5 py-3"><Delta value={row.deltaWin} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
