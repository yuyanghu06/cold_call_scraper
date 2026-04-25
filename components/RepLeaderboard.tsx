"use client";

import type { RepStats } from "@/lib/viewmodels/dashboardViewModel";
import { getRepColor } from "@/lib/config/attioDisplay";

const MEDALS = ["🥇", "🥈", "🥉"];

interface Props {
  reps: RepStats[];
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-neutral-100 rounded-full h-1.5">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function RepLeaderboard({ reps }: Props) {
  if (reps.length === 0) return null;

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
            <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-widest text-neutral-400 font-normal">Calls</th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-neutral-400 font-normal w-40">Pick-up rate</th>
            <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-widest text-neutral-400 font-normal w-40">Win rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {reps.map((rep, i) => {
            const color = getRepColor(i);
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
                    <span className="tabular-nums text-neutral-600 w-9 text-right shrink-0">{rep.pickUpRate}%</span>
                    <Bar pct={rep.pickUpRate} color={color} />
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-neutral-600 w-9 text-right shrink-0">{rep.winRate}%</span>
                    <Bar pct={rep.winRate} color="#22c55e" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
