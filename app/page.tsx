"use client";

import { useState } from "react";
import SearchForm from "@/components/SearchForm";
import ResultsPanel from "@/components/ResultsPanel";
import type { SearchResponse } from "@/lib/types";

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);

  async function runSearch(payload: unknown) {
    setLoading(true);
    setError(null);
    setResult(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setStatusMessage(null);
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-6 pb-8 pt-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <SearchForm loading={loading} onSubmit={runSearch} />
        </section>
        <section className="min-h-[400px]">
          <ResultsPanel
            loading={loading}
            statusMessage={statusMessage}
            error={error}
            result={result}
          />
        </section>
      </div>
    </main>
  );
}
