"use client";

import { useEffect, useState } from "react";
import SearchForm from "@/components/SearchForm";
import ResultsPanel, { type AttioStatus } from "@/components/ResultsPanel";
import { ATTIO_UNLOCK_EVENT } from "@/components/AttioSettings";
import type { Place, SearchRequest, SearchResponse } from "@/lib/types";

export default function LeadGenPage() {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [attio, setAttio] = useState<AttioStatus>({ state: "idle" });
  const [unlocked, setUnlocked] = useState(false);

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
        body: JSON.stringify({ places, keywords }),
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
