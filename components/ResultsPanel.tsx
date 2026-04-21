"use client";

import { useMemo, useState } from "react";
import type { Place, SearchResponse } from "@/lib/types";
import ProgressBar from "./ProgressBar";

interface Props {
  loading: boolean;
  statusMessage: string | null;
  error: string | null;
  result: SearchResponse | null;
}

type SortKey =
  | "name"
  | "phone"
  | "city"
  | "rating"
  | "reviewCount"
  | "verified";

type SortKind = "text" | "number";

const SORT_KINDS: Record<SortKey, SortKind> = {
  name: "text",
  phone: "text",
  city: "text",
  rating: "number",
  reviewCount: "number",
  verified: "number",
};

function sortValue(p: Place, key: SortKey): string | number {
  switch (key) {
    case "name":
      return p.name.toLowerCase();
    case "phone":
      // digits-only so "(555) 123-4567" and "555-123-4567" sort consistently
      return (p.phone ?? "").replace(/\D+/g, "");
    case "city":
      return (p.city ?? "").toLowerCase();
    case "rating":
      return p.rating ?? Number.NEGATIVE_INFINITY;
    case "reviewCount":
      return p.reviewCount ?? Number.NEGATIVE_INFINITY;
    case "verified":
      // verified > unverified > unknown
      if (p.phoneVerified === true) return 2;
      if (p.phoneVerified === false) return 1;
      return 0;
  }
}

export default function ResultsPanel({
  loading,
  statusMessage,
  error,
  result,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("reviewCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showExcluded, setShowExcluded] = useState(false);

  const sortedPreview = useMemo(() => {
    if (!result) return [] as Place[];
    const arr = [...result.results];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr.slice(0, 50);
  }, [result, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to desc (biggest first), text to asc (A→Z).
      setSortDir(SORT_KINDS[key] === "number" ? "desc" : "asc");
    }
  }

  function downloadCsv() {
    if (!result) return;
    const blob = new Blob([result.csvData], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `shift-leads-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
          Running
        </div>
        <ProgressBar message={statusMessage} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
          Error
        </div>
        <p className="text-sm border-l-2 border-neutral-900 pl-3 py-1">
          {error}
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-sm text-neutral-500">
        Results appear here after you run a search.
      </div>
    );
  }

  const noResults = result.results.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            Results
          </div>
          <p className="text-sm text-neutral-600 font-mono tabular-nums">
            {result.totalFound} found &nbsp;·&nbsp; {result.afterDedup} deduped
            &nbsp;·&nbsp; {result.afterFilter} kept
            {result.phoneValidated > 0 &&
              ` · ${result.phoneValidated} verified`}
          </p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={noResults}
          className="bg-neutral-900 hover:bg-black disabled:bg-neutral-400 text-white text-xs uppercase tracking-[0.12em] font-medium px-4 py-2"
        >
          Download CSV
        </button>
      </div>

      {result.warnings.length > 0 && (
        <div className="border-l-2 border-neutral-900 pl-3 py-1 text-xs text-neutral-700">
          <div className="font-medium text-neutral-900 mb-1">
            {result.warnings.length} warning
            {result.warnings.length === 1 ? "" : "s"}
          </div>
          <ul className="space-y-0.5">
            {result.warnings.slice(0, 10).map((w, i) => (
              <li key={i}>— {w}</li>
            ))}
            {result.warnings.length > 10 && (
              <li>… and {result.warnings.length - 10} more</li>
            )}
          </ul>
        </div>
      )}

      {noResults ? (
        <p className="text-sm text-neutral-500">
          No results matched. Try widening the location, loosening filters, or
          adding more keywords.
        </p>
      ) : (
        <div className="border border-neutral-300">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 sticky top-0 border-b border-neutral-300">
                <tr>
                  <Th
                    label="Shop"
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  />
                  <Th
                    label="Phone"
                    active={sortKey === "phone"}
                    dir={sortDir}
                    onClick={() => toggleSort("phone")}
                  />
                  <Th
                    label="City"
                    active={sortKey === "city"}
                    dir={sortDir}
                    onClick={() => toggleSort("city")}
                  />
                  <Th
                    label="Rating"
                    active={sortKey === "rating"}
                    dir={sortDir}
                    onClick={() => toggleSort("rating")}
                  />
                  <Th
                    label="Reviews"
                    active={sortKey === "reviewCount"}
                    dir={sortDir}
                    onClick={() => toggleSort("reviewCount")}
                  />
                  <Th
                    label="Verified"
                    active={sortKey === "verified"}
                    dir={sortDir}
                    onClick={() => toggleSort("verified")}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedPreview.map((p) => (
                  <tr key={p.placeId} className="border-t border-neutral-200">
                    <td
                      className="px-3 py-1.5 max-w-[200px] truncate"
                      title={p.name}
                    >
                      {p.name}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono text-[13px] tabular-nums">
                      {p.phone ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">{p.city ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {p.rating === null ? "—" : p.rating.toFixed(1)}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {p.reviewCount ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-neutral-700">
                      {p.phoneVerified === undefined
                        ? "—"
                        : p.phoneVerified
                          ? p.phoneLineType ?? "yes"
                          : "no"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.results.length > 50 && (
            <p className="text-xs text-neutral-500 px-3 py-2 border-t border-neutral-300 bg-neutral-50">
              Showing first 50 of {result.results.length}. Download the CSV for
              the full list.
            </p>
          )}
        </div>
      )}

      {result.excluded.length > 0 && (
        <details
          className="border border-neutral-300"
          open={showExcluded}
          onToggle={(e) =>
            setShowExcluded((e.target as HTMLDetailsElement).open)
          }
        >
          <summary className="cursor-pointer text-xs uppercase tracking-[0.12em] px-3 py-2 bg-neutral-100 border-b border-neutral-300">
            {result.excluded.length} excluded · chain, review bounds, or no
            phone
          </summary>
          <div className="max-h-[240px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium text-neutral-600">
                    Shop
                  </th>
                  <th className="text-left px-3 py-1.5 font-medium text-neutral-600">
                    Reason
                  </th>
                  <th className="text-left px-3 py-1.5 font-medium text-neutral-600">
                    Reviews
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.excluded.map((p) => (
                  <tr key={p.placeId} className="border-t border-neutral-200">
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-neutral-600 font-mono text-[11px]">
                      {p.excludedReason}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {p.reviewCount ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Th({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="text-left px-3 py-2 font-medium text-[11px] uppercase tracking-[0.1em] text-neutral-600">
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-1 hover:text-neutral-900"
      >
        {label}
        <span className={active ? "text-neutral-900" : "text-neutral-300"}>
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
