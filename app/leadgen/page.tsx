"use client";

import { useEffect, useState } from "react";
import SearchForm from "@/components/SearchForm";
import ResultsPanel, { type AttioStatus } from "@/components/ResultsPanel";
import { ATTIO_UNLOCK_EVENT } from "@/components/AttioSettings";
import type { Place, SearchRequest, SearchResponse } from "@/lib/types";

const CALLER_STORAGE_KEY = "microagi.leadgen.caller";

export default function LeadGenPage() {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [attio, setAttio] = useState<AttioStatus>({ state: "idle" });
  const [unlocked, setUnlocked] = useState(false);
  const [callerOptions, setCallerOptions] = useState<string[]>([]);
  const [caller, setCaller] = useState<string>("");

  useEffect(() => {
    const read = async () => {
      try {
        const res = await fetch("/api/attio/unlock", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { unlocked: boolean };
        setUnlocked(!!data.unlocked);
      } catch {
        // ignore
      }
    };
    void read();
    const onChanged = () => void read();
    window.addEventListener(ATTIO_UNLOCK_EVENT, onChanged);
    return () => window.removeEventListener(ATTIO_UNLOCK_EVENT, onChanged);
  }, []);

  // Restore last-used caller before we have options, so the dropdown shows
  // the right value the instant options arrive.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CALLER_STORAGE_KEY);
      if (saved) setCaller(saved);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/attio/options?attribute=caller", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { options?: string[] };
        if (cancelled || !data.options) return;
        setCallerOptions(data.options);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  function handleCallerChange(next: string) {
    setCaller(next);
    try {
      if (next) window.localStorage.setItem(CALLER_STORAGE_KEY, next);
      else window.localStorage.removeItem(CALLER_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  async function pushToAttio(places: Place[], keywords: string[]) {
    if (!unlocked || places.length === 0) {
      setAttio({ state: "idle" });
      return;
    }
    setAttio({ state: "pushing", total: places.length });
    try {
      const res = await fetch("/api/attio/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places, keywords, caller: caller || null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
        updated?: number;
        skipped?: number;
        failed?: number;
        total?: number;
        errors?: string[];
      };
      if (!res.ok) {
        setAttio({
          state: "error",
          total: places.length,
          errors: [data.error || `Attio push failed (${res.status})`],
        });
        return;
      }
      setAttio({
        state: "done",
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
        total: data.total ?? places.length,
        errors: data.errors ?? [],
      });
    } catch (err) {
      setAttio({
        state: "error",
        total: places.length,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  async function runSearch(payload: SearchRequest) {
    setLoading(true);
    setError(null);
    setResult(null);
    setAttio({ state: "idle" });
    setStatusMessage("Searching Google Places in parallel…");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setStatusMessage("Finalizing results…");
      const data = (await res.json()) as SearchResponse;
      setResult(data);
      void pushToAttio(data.results, payload.keywords);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-8 pt-6 sm:pt-8">
      <CallerBar
        unlocked={unlocked}
        options={callerOptions}
        value={caller}
        onChange={handleCallerChange}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <section>
          <SearchForm loading={loading} onSubmit={runSearch} />
        </section>
        <section className="min-h-[400px]">
          <ResultsPanel
            loading={loading}
            statusMessage={statusMessage}
            error={error}
            result={result}
            attio={attio}
          />
        </section>
      </div>
    </main>
  );
}

function CallerBar(props: {
  unlocked: boolean;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  // Keep the current value visible even if it's been archived in Attio, so a
  // re-render doesn't silently wipe the selection.
  const options = props.value && !props.options.includes(props.value)
    ? [props.value, ...props.options]
    : props.options;

  return (
    <div className="flex flex-wrap items-center gap-3 border border-neutral-300 p-3 mb-4 sm:mb-6">
      <label htmlFor="caller-select" className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
        Caller
      </label>
      <select
        id="caller-select"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={!props.unlocked || options.length === 0}
        className="border border-neutral-300 pl-2 pr-8 py-1.5 text-sm bg-white focus:outline-none focus:border-neutral-900 disabled:opacity-50"
      >
        <option value="">{props.unlocked ? "— Select —" : "Attio locked"}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <p className="text-xs text-neutral-500 leading-snug">
        Applied to every company pushed to Attio from the next search.
        {props.unlocked && options.length === 0 && " (No caller options yet — add them in Attio.)"}
      </p>
    </div>
  );
}
