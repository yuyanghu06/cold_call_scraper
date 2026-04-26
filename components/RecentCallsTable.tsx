"use client";

import { useState, useMemo } from "react";
import type { RecentCall } from "@/lib/viewmodels/dashboardViewModel";
import { getStatusColor } from "@/lib/config/attioDisplay";

const PAGE_SIZE = 10;

type SortKey = "name" | "caller" | "callStatus" | "industry" | "callStatusUpdatedAt";
type SortDir = "asc" | "desc";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
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
  calls: RecentCall[];
  loading?: boolean;
}

export default function RecentCallsTable({ calls, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("callStatusUpdatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "callStatusUpdatedAt" ? "desc" : "asc");
    }
    setPage(0);
  }

  const sorted = useMemo(() => {
    return [...calls].sort((a, b) => {
      const av = sortKey === "callStatusUpdatedAt" ? a.callStatusUpdatedAt : (a[sortKey] ?? "").toLowerCase();
      const bv = sortKey === "callStatusUpdatedAt" ? b.callStatusUpdatedAt : (b[sortKey] ?? "").toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [calls, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function SortBtn({ label, sortK, right }: { label: string; sortK: SortKey; right?: boolean }) {
    return (
      <button
        onClick={() => handleSort(sortK)}
        className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-widest font-normal text-neutral-400 hover:text-neutral-700 select-none ${right ? "ml-auto" : ""}`}
      >
        {label}
        <SortIcon active={sortKey === sortK} dir={sortDir} />
      </button>
    );
  }

  if (loading) {
    return (
      <div className="border border-neutral-200 rounded-lg p-5">
        <div className="text-[13px] font-medium mb-3">Recent calls</div>
        <div className="text-sm text-neutral-400">Loading…</div>
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="border border-neutral-200 rounded-lg p-5">
        <div className="text-[13px] font-medium mb-3">Recent calls</div>
        <div className="text-sm text-neutral-400">No calls logged yet.</div>
      </div>
    );
  }

  const Pagination = () => (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-neutral-400 tabular-nums">
        {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
      </span>
      <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
        className="px-2.5 py-1 text-[12px] rounded border border-neutral-200 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 disabled:cursor-not-allowed">←</button>
      <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
        className="px-2.5 py-1 text-[12px] rounded border border-neutral-200 text-neutral-500 hover:text-neutral-900 disabled:opacity-30 disabled:cursor-not-allowed">→</button>
    </div>
  );

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      {/* Header: title + sort controls + pagination */}
      <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-medium">Recent calls</span>
          <div className="flex items-center gap-3">
            <SortBtn label="Company" sortK="name" />
            <SortBtn label="Caller" sortK="caller" />
            <SortBtn label="Industry" sortK="industry" />
            <SortBtn label="Status" sortK="callStatus" />
            <SortBtn label="Time" sortK="callStatusUpdatedAt" />
          </div>
        </div>
        {totalPages > 1 && <Pagination />}
      </div>

      {/* Table */}
      <table className="w-full text-[13px]">
        <tbody className="divide-y divide-neutral-100">
          {pageRows.map((call) => {
            const style = call.callStatus ? getStatusColor(call.callStatus) : null;
            return (
              <tr key={call.id} className="hover:bg-neutral-50 transition-colors">
                <td className="px-5 py-3 font-medium truncate max-w-[240px]">
                  {call.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-500 w-28">
                  {call.caller ?? <span className="text-neutral-300">—</span>}
                </td>
                <td className="px-4 py-3 text-neutral-400 text-[12px] w-28 capitalize">
                  {call.industry ?? <span className="text-neutral-300">—</span>}
                </td>
                <td className="px-4 py-3 w-36">
                  {call.callStatus && style ? (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
                      style={{ background: style.bg, color: style.text }}
                    >
                      {call.callStatus}
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right text-neutral-400 tabular-nums whitespace-nowrap w-36">
                  {formatDateTime(call.callStatusUpdatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
