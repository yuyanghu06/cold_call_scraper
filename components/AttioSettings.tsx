"use client";

import { useEffect, useState } from "react";

interface UnlockStatus {
  unlocked: boolean;
  serverConfigured: boolean;
}

// Emit/listen for this so other client components (manual entry form, tracking
// page, home-page push status) can re-check unlock state without polling.
export const ATTIO_UNLOCK_EVENT = "microagi:attio-unlock-changed";

export default function AttioSettings() {
  const [status, setStatus] = useState<UnlockStatus | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/attio/unlock", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as UnlockStatus;
        setStatus(data);
      }
    } catch {
      // ignore — UI will just stay in its initial state
    }
  }

  async function unlock() {
    const attempt = password.trim();
    if (!attempt) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/attio/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: attempt }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || `Unlock failed (${res.status})`);
        return;
      }
      setPassword("");
      setStatus((s) =>
        s ? { ...s, unlocked: true } : { unlocked: true, serverConfigured: true },
      );
      window.dispatchEvent(new Event(ATTIO_UNLOCK_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function lock() {
    try {
      const res = await fetch("/api/attio/unlock", { method: "DELETE" });
      if (res.ok) {
        setStatus((s) =>
          s ? { ...s, unlocked: false } : { unlocked: false, serverConfigured: true },
        );
        window.dispatchEvent(new Event(ATTIO_UNLOCK_EVENT));
      }
    } catch {
      // ignore
    }
  }

  return (
    <section className="border border-neutral-300 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            Attio integration
          </div>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed max-w-xl">
            Enter the shared access password to unlock Attio features for this
            browser. The Attio API key lives on the server — you don&apos;t need
            to know or paste it. Unlock persists for 30 days per device.
          </p>
        </div>
        {status && (
          <span
            className={
              status.unlocked
                ? "shrink-0 text-[10px] uppercase tracking-[0.14em] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5"
                : "shrink-0 text-[10px] uppercase tracking-[0.14em] text-neutral-600 bg-neutral-100 border border-neutral-300 px-2 py-0.5"
            }
          >
            {status.unlocked ? "Unlocked" : "Locked"}
          </span>
        )}
      </div>

      {status && !status.serverConfigured && (
        <p className="text-xs border-l-2 border-amber-600 bg-amber-50 pl-3 py-2 text-amber-900">
          Server env isn&apos;t fully configured — ATTIO_API_KEY and
          ATTIO_ACCESS_PASSWORD must both be set. Contact an admin.
        </p>
      )}

      {status?.unlocked ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-600">
            Attio features are unlocked in this browser.
          </span>
          <button
            type="button"
            onClick={lock}
            className="text-[11px] uppercase tracking-[0.12em] text-neutral-500 hover:text-neutral-900"
          >
            Lock
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Access password"
            disabled={submitting || !status?.serverConfigured}
            className="flex-1 border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 bg-white disabled:bg-neutral-50"
          />
          <button
            type="submit"
            disabled={submitting || !password.trim() || !status?.serverConfigured}
            className="bg-neutral-900 hover:bg-black disabled:bg-neutral-400 text-white text-[11px] uppercase tracking-[0.12em] font-medium px-4 py-2"
          >
            {submitting ? "Checking…" : "Unlock"}
          </button>
        </form>
      )}

      {error && (
        <p className="text-xs text-red-800 bg-red-50 border border-red-200 px-2 py-1">
          {error}
        </p>
      )}
    </section>
  );
}
