"use client";

import { useState, useMemo } from "react";
import type { RepStats } from "@/lib/viewmodels/dashboardViewModel";
import { getRepColor } from "@/lib/config/attioDisplay";

const MEDALS = ["🥇", "🥈", "🥉"];

type SortKey = "totalCalls" | "pickUpRate" | "pickedUp" | "winRate" | "positive";
type SortDir = "asc" | "desc";

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-24 bg-neutral-100 rounded-full h-1.5">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
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
  reps: RepStats[];
}

export default function RepLeaderboard({ reps }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalCalls");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => [...reps].sort((a, b) => {
    const cmp = a[sortKey] - b[sortKey];
    return sortDir === "asc" ? cmp : -cmp;
  }), [reps, sortKey, sortDir]);

  if (reps.length === 0) return null;

  function ColHeader({ label, sortK }: { label: string; sortK: SortKey }) {
    return (
      <th onClick={() => handleSort(sortK)}
        className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-neutral-400 font-normal cursor-pointer select-none hover:text-neutral-700 whitespace-nowrap">
        <span className="inline-flex items-center">
          {label}
          <SortIcon active={sortKey === sortK} dir={sortDir} />
        </span>
      </th>
    );
  }

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100">
        <span className="text-[13px] font-medium">Rep leaderboard</span>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-50">
            <th className="px-5 py-2.5 text-left text-[11px] uppercase tracking-widest text-neutral-400 font-normal w-8">#</th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-neutral-400 font-normal">Rep</th>
            <ColHeader label="Calls" sortK="totalCalls" />
            <ColHeader label="Pick-up rate" sortK="pickUpRate" />
            <ColHeader label="Picked up" sortK="pickedUp" />
            <ColHeader label="Win rate" sortK="winRate" />
            <ColHeader label="Won" sortK="positive" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {sorted.map((rep, i) => {
            const color = getRepColor(reps.indexOf(rep));
            return (
              <tr key={rep.name} className="hover:bg-neutral-50 transition-colors">
                <td className="px-5 py-3.5 text-neutral-400 text-[13px]">
                  {MEDALS[i] ?? <span className="text-neutral-300">{i + 1}</span>}
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="font-medium">{rep.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 text-right font-semibold tabular-nums">{rep.totalCalls.toLocaleString()}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-neutral-800 w-9 text-right shrink-0">{rep.pickUpRate}%</span>
                    <Bar pct={rep.pickUpRate} color={color} />
                  </div>
                </td>
                <td className="px-4 py-3.5 tabular-nums text-neutral-500 text-[12px]">
                  {rep.pickedUp}<span className="text-neutral-300">/{rep.totalCalls}</span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-neutral-800 w-9 text-right shrink-0">{rep.winRate}%</span>
                    <Bar pct={rep.winRate} color="#22c55e" />
                  </div>
                </td>
                <td className="px-4 py-3.5 tabular-nums text-neutral-500 text-[12px]">
                  {rep.positive}<span className="text-neutral-300">/{rep.totalCalls}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
