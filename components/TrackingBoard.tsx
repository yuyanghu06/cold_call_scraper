"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ATTIO_UNLOCK_EVENT } from "./AttioSettings";
import MultiSelect from "./MultiSelect";

interface TrackingCompany {
  id: string;
  name: string | null;
  territory: string[];
  callStatus: string | null;
  industry: string | null;
  address: string | null;
  ownerName: string | null;
  companyNumber: string | null;
  followUpNumber: string | null;
  notes: string | null;
  caller: string | null;
}

interface ListResponse {
  companies: TrackingCompany[];
  nextOffset: number | null;
  error?: string;
}

interface OptionsResponse {
  options: string[];
  error?: string;
}

const PAGE_SIZE = 100;

// Apple's maps.apple.com URL opens natively in the Maps app on macOS and iOS;
// on Windows/Android/Linux it lands on a web page that's useless without the
// Apple ecosystem, so non-Apple users get Google Maps instead. UA sniffing
// isn't ideal but navigator.userAgentData isn't universal yet.
function getMapsUrl(address: string): string {
  const encoded = encodeURIComponent(address);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isApple = /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(ua);
  return isApple
    ? `https://maps.apple.com/?q=${encoded}`
    : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}

export default function TrackingBoard() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [territoryOptions, setTerritoryOptions] = useState<string[]>([]);
  const [callStatusOptions, setCallStatusOptions] = useState<string[]>([]);
  const [callerOptions, setCallerOptions] = useState<string[]>([]);
  // Industry is a free-text attribute in Attio — no options endpoint. Instead,
  // we accumulate the unique values seen in loaded rows. Grows as more rows
  // load; never shrinks when a filter is applied so the dropdown stays stable.
  const [industryOptions, setIndustryOptions] = useState<string[]>([]);
  const [territoryFilter, setTerritoryFilter] = useState<string[]>([]);
  const [callStatusFilter, setCallStatusFilter] = useState<string[]>([]);
  const [industryFilter, setIndustryFilter] = useState<string[]>([]);
  const [callerFilter, setCallerFilter] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState<TrackingCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadMoreAvailable, setLoadMoreAvailable] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const read = async () => {
      try {
        const res = await fetch("/api/attio/unlock", { cache: "no-store" });
        if (!res.ok) return setUnlocked(false);
        const data = (await res.json()) as { unlocked: boolean };
        setUnlocked(!!data.unlocked);
      } catch {
        setUnlocked(false);
      }
    };
    void read();
    const onChanged = () => void read();
    window.addEventListener(ATTIO_UNLOCK_EVENT, onChanged);
    return () => window.removeEventListener(ATTIO_UNLOCK_EVENT, onChanged);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void loadOptions();
  }, [unlocked]);

  async function loadOptions() {
    try {
      const [t, c, ca] = await Promise.all([
        fetch("/api/attio/options?attribute=territory").then(
          (r) => r.json() as Promise<OptionsResponse>,
        ),
        fetch("/api/attio/options?attribute=callStatus").then(
          (r) => r.json() as Promise<OptionsResponse>,
        ),
        fetch("/api/attio/options?attribute=caller").then(
          (r) => r.json() as Promise<OptionsResponse>,
        ),
      ]);
      if (t.options) setTerritoryOptions(t.options);
      if (c.options) setCallStatusOptions(c.options);
      if (ca.options) setCallerOptions(ca.options);
    } catch {
      // non-fatal; dropdowns will just be empty
    }
  }

  const fetchList = useCallback(
    async (opts: { append: boolean; offset: number }) => {
      const myReq = ++reqId.current;
      setLoading(true);
      setListError(null);
      try {
        const url = new URL("/api/attio/companies", window.location.origin);
        for (const t of territoryFilter) url.searchParams.append("territory", t);
        for (const c of callStatusFilter)
          url.searchParams.append("callStatus", c);
        for (const i of industryFilter) url.searchParams.append("industry", i);
        for (const c of callerFilter) url.searchParams.append("caller", c);
        if (searchQuery) url.searchParams.set("search", searchQuery);
        url.searchParams.set("limit", String(PAGE_SIZE));
        url.searchParams.set("offset", String(opts.offset));
        const res = await fetch(url.toString(), { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as ListResponse;
        if (reqId.current !== myReq) return; // stale
        if (!res.ok) {
          setListError(data.error || `Request failed (${res.status})`);
          return;
        }
        const fetched = data.companies ?? [];
        setRows((prev) => (opts.append ? [...prev, ...fetched] : fetched));
        setIndustryOptions((prev) => {
          const seen = new Set(prev);
          for (const row of fetched) {
            if (row.industry) seen.add(row.industry);
          }
          return Array.from(seen).sort((a, b) => a.localeCompare(b));
        });
        setLoadMoreAvailable(data.nextOffset !== null);
      } catch (err) {
        if (reqId.current !== myReq) return;
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId.current === myReq) setLoading(false);
      }
    },
    [territoryFilter, callStatusFilter, industryFilter, callerFilter, searchQuery],
  );

  useEffect(() => {
    if (!unlocked) return;
    void fetchList({ append: false, offset: 0 });
  }, [unlocked, fetchList]);

  // Debounce the search input so we don't hit Attio on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  function updateLocalRow(id: string, patch: Partial<TrackingCompany>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  if (unlocked === null) {
    return (
      <p className="text-sm text-neutral-500">Checking Attio access…</p>
    );
  }
  if (!unlocked) {
    return (
      <div className="border border-neutral-300 p-5 space-y-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
          Attio locked
        </div>
        <p className="text-sm text-neutral-700">
          Lead tracking needs Attio access. Enter the access password in{" "}
          <a
            href="/settings"
            className="underline underline-offset-2 hover:text-neutral-900"
          >
            Settings
          </a>{" "}
          to unlock reads + writes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FilterBar
        territoryOptions={territoryOptions}
        callStatusOptions={callStatusOptions}
        industryOptions={industryOptions}
        callerOptions={callerOptions}
        territoryFilter={territoryFilter}
        callStatusFilter={callStatusFilter}
        industryFilter={industryFilter}
        callerFilter={callerFilter}
        searchInput={searchInput}
        onTerritoryChange={setTerritoryFilter}
        onCallStatusChange={setCallStatusFilter}
        onIndustryChange={setIndustryFilter}
        onCallerChange={setCallerFilter}
        onSearchChange={setSearchInput}
        onClear={() => {
          setTerritoryFilter([]);
          setCallStatusFilter([]);
          setIndustryFilter([]);
          setCallerFilter([]);
          setSearchInput("");
        }}
        count={rows.length}
        hasMore={loadMoreAvailable}
        loading={loading}
      />

      {listError && (
        <p className="text-xs text-red-800 bg-red-50 border border-red-200 px-3 py-2">
          {listError}
        </p>
      )}

      <CompaniesTable
        rows={rows}
        territoryOptions={territoryOptions}
        callStatusOptions={callStatusOptions}
        callerOptions={callerOptions}
        onRowUpdated={updateLocalRow}
        onAfterUpdate={() => void fetchList({ append: false, offset: 0 })}
      />

      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500">
          {rows.length} row{rows.length === 1 ? "" : "s"} loaded
          {loadMoreAvailable ? " (more available)" : ""}
        </div>
        {loadMoreAvailable && (
          <button
            type="button"
            onClick={() => void fetchList({ append: true, offset: rows.length })}
            disabled={loading}
            className="text-[11px] uppercase tracking-[0.12em] border border-neutral-300 px-3 py-2 hover:border-neutral-900 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}

function FilterBar(props: {
  territoryOptions: string[];
  callStatusOptions: string[];
  industryOptions: string[];
  callerOptions: string[];
  territoryFilter: string[];
  callStatusFilter: string[];
  industryFilter: string[];
  callerFilter: string[];
  searchInput: string;
  onTerritoryChange: (v: string[]) => void;
  onCallStatusChange: (v: string[]) => void;
  onIndustryChange: (v: string[]) => void;
  onCallerChange: (v: string[]) => void;
  onSearchChange: (v: string) => void;
  onClear: () => void;
  count: number;
  hasMore: boolean;
  loading: boolean;
}) {
  const hasActiveFilters =
    props.territoryFilter.length > 0 ||
    props.callStatusFilter.length > 0 ||
    props.industryFilter.length > 0 ||
    props.callerFilter.length > 0 ||
    props.searchInput.length > 0;
  return (
    <div className="flex flex-wrap items-end gap-3 border border-neutral-300 p-3">
      <label className="flex flex-col gap-1 min-w-[200px]">
        <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-500">
          Search company
        </span>
        <input
          type="text"
          value={props.searchInput}
          onChange={(e) => props.onSearchChange(e.target.value)}
          placeholder="Name contains…"
          className="border border-neutral-300 px-2 py-1 text-xs bg-white focus:outline-none focus:border-neutral-900"
        />
      </label>
      <MultiSelect
        label="Territory"
        value={props.territoryFilter}
        options={props.territoryOptions}
        onChange={props.onTerritoryChange}
      />
      <MultiSelect
        label="Call status"
        value={props.callStatusFilter}
        options={props.callStatusOptions}
        onChange={props.onCallStatusChange}
      />
      <MultiSelect
        label="Industry"
        value={props.industryFilter}
        options={props.industryOptions}
        onChange={props.onIndustryChange}
      />
      <MultiSelect
        label="Caller"
        value={props.callerFilter}
        options={props.callerOptions}
        onChange={props.onCallerChange}
      />
      <button
        type="button"
        onClick={props.onClear}
        disabled={!hasActiveFilters}
        className="text-[11px] uppercase tracking-[0.12em] text-neutral-500 hover:text-neutral-900 disabled:opacity-30 pb-2"
      >
        Clear filters
      </button>
      <div className="ml-auto text-[11px] uppercase tracking-[0.12em] text-neutral-500 pb-2">
        {props.loading ? "Loading…" : `${props.count} rows`}
      </div>
    </div>
  );
}

type SortKey =
  | "name"
  | "territory"
  | "callStatus"
  | "industry"
  | "address"
  | "ownerName"
  | "companyNumber"
  | "followUpNumber"
  | "notes"
  | "caller";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir } | null;

function getSortValue(r: TrackingCompany, key: SortKey): string | null {
  if (key === "territory") return r.territory[0] ?? null;
  const v = r[key];
  return typeof v === "string" ? v : null;
}

function CompaniesTable(props: {
  rows: TrackingCompany[];
  territoryOptions: string[];
  callStatusOptions: string[];
  callerOptions: string[];
  onRowUpdated: (id: string, patch: Partial<TrackingCompany>) => void;
  onAfterUpdate: () => void;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return props.rows;
    const copy = [...props.rows];
    copy.sort((a, b) => {
      const av = getSortValue(a, sort.key);
      const bv = getSortValue(b, sort.key);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls/empties always last
      if (bv === null) return -1;
      // numeric:true makes "Phone 2" < "Phone 10" and handles numeric-looking
      // strings (e.g. follow-up numbers) in their natural order.
      const cmp = av.localeCompare(bv, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [props.rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears
    });
  }

  if (props.rows.length === 0) {
    return (
      <div className="border border-neutral-300 p-8 text-center text-sm text-neutral-500">
        No companies match these filters.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border border-neutral-300 -mx-4 sm:mx-0">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead className="bg-neutral-50">
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-neutral-500">
            <SortableTh sticky sortKey="name" sort={sort} onToggle={toggleSort}>
              Company
            </SortableTh>
            <SortableTh sortKey="territory" sort={sort} onToggle={toggleSort}>
              Territory
            </SortableTh>
            <SortableTh sortKey="callStatus" sort={sort} onToggle={toggleSort}>
              Call status
            </SortableTh>
            <SortableTh sortKey="caller" sort={sort} onToggle={toggleSort}>
              Caller
            </SortableTh>
            <SortableTh sortKey="industry" sort={sort} onToggle={toggleSort}>
              Industry
            </SortableTh>
            <SortableTh sortKey="address" sort={sort} onToggle={toggleSort}>
              Address
            </SortableTh>
            <SortableTh sortKey="ownerName" sort={sort} onToggle={toggleSort}>
              Owner name
            </SortableTh>
            <SortableTh
              sortKey="companyNumber"
              sort={sort}
              onToggle={toggleSort}
            >
              Company number
            </SortableTh>
            <SortableTh
              sortKey="followUpNumber"
              sort={sort}
              onToggle={toggleSort}
            >
              Follow-up contact
            </SortableTh>
            <SortableTh sortKey="notes" sort={sort} onToggle={toggleSort}>
              Notes
            </SortableTh>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <CompanyRow
              key={row.id}
              row={row}
              territoryOptions={props.territoryOptions}
              callStatusOptions={props.callStatusOptions}
              callerOptions={props.callerOptions}
              onUpdated={(patch) => props.onRowUpdated(row.id, patch)}
              onAfterUpdate={props.onAfterUpdate}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh(props: {
  children: React.ReactNode;
  sortKey: SortKey;
  sort: SortState;
  onToggle: (k: SortKey) => void;
  sticky?: boolean;
}) {
  const active = props.sort?.key === props.sortKey;
  const dir = active ? props.sort!.dir : null;
  const cellClass = props.sticky
    ? "px-3 py-2 font-medium sticky left-0 bg-neutral-50 border-b border-r border-neutral-300 z-20"
    : "px-3 py-2 font-medium border-b border-neutral-300";
  return (
    <th className={cellClass}>
      <button
        type="button"
        onClick={() => props.onToggle(props.sortKey)}
        className={`inline-flex items-center gap-1.5 uppercase tracking-[0.14em] whitespace-nowrap ${
          active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-900"
        }`}
      >
        <span>{props.children}</span>
        <SortIndicator dir={dir} />
      </button>
    </th>
  );
}

function SortIndicator({ dir }: { dir: SortDir | null }) {
  if (dir === null) {
    return (
      <svg
        width="9"
        height="9"
        viewBox="0 0 10 10"
        className="text-neutral-300"
        aria-hidden
      >
        <path
          d="M3 4l2-2 2 2M3 6l2 2 2-2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
      <path
        d={dir === "asc" ? "M3 6l2-2 2 2" : "M3 4l2 2 2-2"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type EditableField =
  | "name"
  | "territory"
  | "callStatus"
  | "industry"
  | "address"
  | "ownerName"
  | "companyNumber"
  | "followUpNumber"
  | "notes"
  | "caller";

function CompanyRow(props: {
  row: TrackingCompany;
  territoryOptions: string[];
  callStatusOptions: string[];
  callerOptions: string[];
  onUpdated: (patch: Partial<TrackingCompany>) => void;
  onAfterUpdate: () => void;
}) {
  const [saving, setSaving] = useState<EditableField | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(
    field: EditableField,
    patch: Partial<TrackingCompany>,
    body: Record<string, unknown>,
  ) {
    setSaving(field);
    setError(null);
    try {
      const res = await fetch(`/api/attio/companies/${props.row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        company?: TrackingCompany;
      };
      if (!res.ok) {
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      // Reflect what the server ended up storing (option titles may normalize).
      if (data.company) props.onUpdated(data.company);
      else props.onUpdated(patch);
      // Re-query Attio so any row that no longer matches the active filters
      // drops out of the visible list.
      props.onAfterUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <tr className="align-top group">
      <td className="px-3 py-2 min-w-[180px] sticky left-0 bg-white group-hover:bg-neutral-50/80 border-b border-r border-neutral-200 z-10">
        <TextCell
          value={props.row.name ?? ""}
          saving={saving === "name"}
          placeholder="—"
          onCommit={(next) => {
            if (!next) return; // Attio rejects empty names; don't even try
            persist("name", { name: next }, { name: next });
          }}
          inputClass="font-medium text-neutral-900"
        />
        {error && (
          <div
            className="text-[11px] text-red-700 mt-1 max-w-[200px]"
            title={error}
          >
            {error}
          </div>
        )}
      </td>
      <td className="px-3 py-2 min-w-[140px] border-b border-neutral-200">
        <SingleSelectCell
          value={props.row.territory[0] ?? ""}
          options={props.territoryOptions}
          placeholder="—"
          saving={saving === "territory"}
          onChange={(next) =>
            persist(
              "territory",
              { territory: next ? [next] : [] },
              { territory: next ? [next] : [] },
            )
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[180px] border-b border-neutral-200">
        <SingleSelectCell
          value={props.row.callStatus ?? ""}
          options={props.callStatusOptions}
          placeholder="—"
          saving={saving === "callStatus"}
          onChange={(next) =>
            persist("callStatus", { callStatus: next || null }, { callStatus: next || null })
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[140px] border-b border-neutral-200">
        <SingleSelectCell
          value={props.row.caller ?? ""}
          options={props.callerOptions}
          placeholder="—"
          saving={saving === "caller"}
          onChange={(next) =>
            persist("caller", { caller: next || null }, { caller: next || null })
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[140px] border-b border-neutral-200">
        <TextCell
          value={props.row.industry ?? ""}
          saving={saving === "industry"}
          placeholder="—"
          onCommit={(next) =>
            persist("industry", { industry: next || null }, { industry: next || null })
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[220px] max-w-[320px] border-b border-neutral-200">
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            <TextCell
              value={props.row.address ?? ""}
              saving={saving === "address"}
              placeholder="—"
              onCommit={(next) =>
                persist(
                  "address",
                  { address: next || null },
                  { address: next || null },
                )
              }
            />
          </div>
          {props.row.address && (
            <a
              href={getMapsUrl(props.row.address)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Maps"
              className="shrink-0 mt-0.5 text-neutral-400 hover:text-neutral-900"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path
                  d="M6 3H3v10h10V10M10 3h3v3M13 3L8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          )}
        </div>
      </td>
      <td className="px-3 py-2 min-w-[160px] border-b border-neutral-200">
        <TextCell
          value={props.row.ownerName ?? ""}
          saving={saving === "ownerName"}
          placeholder="—"
          onCommit={(next) =>
            persist(
              "ownerName",
              { ownerName: next || null },
              { ownerName: next || null },
            )
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[150px] border-b border-neutral-200">
        <TextCell
          value={props.row.companyNumber ?? ""}
          saving={saving === "companyNumber"}
          placeholder="—"
          onCommit={(next) =>
            persist(
              "companyNumber",
              { companyNumber: next || null },
              { companyNumber: next || null },
            )
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[150px] border-b border-neutral-200">
        <TextCell
          value={props.row.followUpNumber ?? ""}
          saving={saving === "followUpNumber"}
          placeholder="—"
          onCommit={(next) =>
            persist(
              "followUpNumber",
              { followUpNumber: next || null },
              { followUpNumber: next || null },
            )
          }
        />
      </td>
      <td className="px-3 py-2 min-w-[220px] border-b border-neutral-200">
        <TextCell
          value={props.row.notes ?? ""}
          saving={saving === "notes"}
          placeholder="—"
          multiline
          onCommit={(next) =>
            persist("notes", { notes: next || null }, { notes: next || null })
          }
        />
      </td>
    </tr>
  );
}

function SingleSelectCell(props: {
  value: string;
  options: string[];
  placeholder: string;
  saving: boolean;
  onChange: (next: string) => void;
}) {
  // If the current value isn't in the loaded option list, still show it so
  // existing data doesn't get wiped by a render.
  const options = useMemo(() => {
    if (!props.value || props.options.includes(props.value)) return props.options;
    return [props.value, ...props.options];
  }, [props.options, props.value]);
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      disabled={props.saving}
      // pr-6 reserves room for the browser's native chevron so long option
      // labels (e.g. "No Decision Maker") don't render underneath it.
      className="w-full border border-neutral-300 pl-2 pr-6 py-1 text-xs bg-white focus:outline-none focus:border-neutral-900 disabled:opacity-50"
    >
      <option value="">{props.placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function TextCell(props: {
  value: string;
  saving: boolean;
  placeholder: string;
  multiline?: boolean;
  onCommit: (next: string) => void;
  inputClass?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);

  // Keep local draft in sync when server-side value updates (e.g. new fetch).
  useEffect(() => {
    if (!focused) setDraft(props.value);
  }, [props.value, focused]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === props.value.trim()) return;
    props.onCommit(trimmed);
  };

  const common = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      commit();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !props.multiline) {
        e.preventDefault();
        e.currentTarget.blur();
      }
      if (e.key === "Escape") {
        setDraft(props.value);
        e.currentTarget.blur();
      }
    },
    placeholder: props.placeholder,
    disabled: props.saving,
    className: `w-full border border-neutral-200 hover:border-neutral-300 focus:border-neutral-900 px-2 py-1 text-xs bg-white focus:outline-none disabled:opacity-50 ${props.inputClass ?? ""}`,
  };
  return props.multiline ? (
    <textarea rows={2} {...common} />
  ) : (
    <input type="text" {...common} />
  );
}
