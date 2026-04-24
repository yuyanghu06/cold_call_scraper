"use client";

import { useEffect, useRef, useState } from "react";
import { ATTIO_UNLOCK_EVENT } from "./AttioSettings";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      outcome: "created" | "updated" | "skipped";
      name: string;
    }
  | { kind: "error"; message: string };

const INPUT_CLASS =
  "w-full border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-neutral-900 bg-white";
const LABEL_CLASS =
  "block text-[11px] uppercase tracking-[0.14em] text-neutral-500 mb-1.5";

// Call Status + Stage options are loaded live from Attio at mount so the form
// only ever offers values the workspace has actually configured. Hardcoded
// fallbacks caused 400s when a listed option (e.g. "Callback") didn't exist.
const RESULT_FALLBACK = ["Not called yet"];
const STAGE_FALLBACK = ["Cold Lead"];

export default function ManualCompanyForm() {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [territory, setTerritory] = useState("");
  const [stage, setStage] = useState("");
  const [result, setResult] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [followUpNumber, setFollowUpNumber] = useState("");
  const [caller, setCaller] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [unlocked, setUnlocked] = useState(false);
  const [resultOptions, setResultOptions] = useState<string[]>(RESULT_FALLBACK);
  const [stageOptions, setStageOptions] = useState<string[]>(STAGE_FALLBACK);

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

  // Pull Call Status + Stage options live from Attio whenever we're unlocked,
  // so the dropdowns match whatever the workspace has configured.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const [callStatusRes, stageRes] = await Promise.all([
          fetch("/api/attio/options?attribute=callStatus", { cache: "no-store" }),
          fetch("/api/attio/options?attribute=stage", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (callStatusRes.ok) {
          const data = (await callStatusRes.json()) as { options?: string[] };
          if (data.options && data.options.length > 0) setResultOptions(data.options);
        }
        if (stageRes.ok) {
          const data = (await stageRes.json()) as { options?: string[] };
          if (data.options && data.options.length > 0) setStageOptions(data.options);
        }
      } catch {
        // fall back to defaults already in state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus({ kind: "error", message: "Business name is required." });
      return;
    }
    if (!unlocked) {
      setStatus({
        kind: "error",
        message: "Attio is locked. Unlock it in Settings first.",
      });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/attio/create-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          industry: industry.trim() || null,
          territory: territory.trim() || null,
          stage: stage.trim() || null,
          result: result.trim() || null,
          ownerName: ownerName.trim() || null,
          followUpNumber: followUpNumber.trim() || null,
          caller: caller.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
        updated?: number;
        skipped?: number;
        failed?: number;
        errors?: string[];
      };
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data.error || `Request failed (${res.status})`,
        });
        return;
      }
      if ((data.failed ?? 0) > 0) {
        setStatus({
          kind: "error",
          message: data.errors?.[0] || "Attio rejected the write.",
        });
        return;
      }
      let outcome: "created" | "updated" | "skipped" = "created";
      if ((data.updated ?? 0) === 1) outcome = "updated";
      else if ((data.skipped ?? 0) === 1) outcome = "skipped";
      setStatus({ kind: "success", outcome, name: trimmedName });
      setName("");
      setIndustry("");
      setTerritory("");
      setStage("");
      setResult("");
      setOwnerName("");
      setFollowUpNumber("");
      setCaller("");
      setNotes("");
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <section className="border border-neutral-300 p-5 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
          Manual entry
        </div>
        <h3 className="text-base font-medium tracking-tight mt-1">
          Create a single company in Attio
        </h3>
        <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
          For one-off additions (a shop you found offline, a referral, etc.).
          Upserts by Business Name — re-submitting the same name fills empty
          fields only, never overwrites existing values. Leaving Result empty
          defaults Call Status to &ldquo;Not called yet&rdquo;.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="mcf-name" className={LABEL_CLASS}>
            Business name *
          </label>
          <input
            id="mcf-name"
            type="text"
            className={INPUT_CLASS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Auto Repair"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="mcf-industry" className={LABEL_CLASS}>
              Industry
            </label>
            <input
              id="mcf-industry"
              type="text"
              className={INPUT_CLASS}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="automotive"
            />
          </div>
          <div>
            <label htmlFor="mcf-territory" className={LABEL_CLASS}>
              Territory
            </label>
            <input
              id="mcf-territory"
              type="text"
              className={INPUT_CLASS}
              value={territory}
              onChange={(e) => setTerritory(e.target.value)}
              placeholder="NY or New York"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="mcf-stage" className={LABEL_CLASS}>
              Stage
            </label>
            <SelectDropdown
              id="mcf-stage"
              value={stage}
              onChange={setStage}
              options={stageOptions}
              placeholder="Cold Lead"
            />
          </div>
          <div>
            <label htmlFor="mcf-result" className={LABEL_CLASS}>
              Result (→ Call Status)
            </label>
            <SelectDropdown
              id="mcf-result"
              value={result}
              onChange={setResult}
              options={resultOptions}
              placeholder="Not called yet"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="mcf-owner" className={LABEL_CLASS}>
              Owner name
            </label>
            <input
              id="mcf-owner"
              type="text"
              className={INPUT_CLASS}
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Jeff"
            />
          </div>
          <div>
            <label htmlFor="mcf-followup-number" className={LABEL_CLASS}>
              Follow-up contact
            </label>
            <input
              id="mcf-followup-number"
              type="tel"
              className={INPUT_CLASS}
              value={followUpNumber}
              onChange={(e) => setFollowUpNumber(e.target.value)}
              placeholder="+1 555 123 4567"
            />
          </div>
        </div>

        <div>
          <label htmlFor="mcf-caller" className={LABEL_CLASS}>
            Caller
          </label>
          <input
            id="mcf-caller"
            type="text"
            className={INPUT_CLASS}
            value={caller}
            onChange={(e) => setCaller(e.target.value)}
            placeholder="Who's making the calls"
          />
        </div>

        <div>
          <label htmlFor="mcf-notes" className={LABEL_CLASS}>
            Notes
          </label>
          <textarea
            id="mcf-notes"
            className={`${INPUT_CLASS} resize-y min-h-[80px]`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra context — meeting notes, referrer, etc."
          />
        </div>

        {!unlocked && (
          <p className="text-xs border-l-2 border-neutral-900 pl-3 py-1 text-neutral-700">
            Attio is locked — unlock it in{" "}
            <a
              href="/settings"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              Settings
            </a>{" "}
            before submitting.
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !unlocked || !name.trim()}
            className="bg-neutral-900 hover:bg-black disabled:bg-neutral-400 text-white text-sm font-medium py-2 px-5 tracking-wide"
          >
            {submitting ? "Creating…" : "Create in Attio"}
          </button>
          <StatusBanner status={status} />
        </div>
      </form>
    </section>
  );
}

function SelectDropdown({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = options.indexOf(value);
    setHighlight(idx >= 0 ? idx : 0);
  }, [open, value, options]);

  function commit(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onButtonKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onListKey(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0) commit(options[highlight]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (open && listRef.current) listRef.current.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
        className={`${INPUT_CLASS} flex items-center justify-between text-left`}
      >
        <span className={value ? "text-neutral-900" : "text-neutral-400"}>
          {value || placeholder}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="ml-2 text-neutral-500 shrink-0"
          aria-hidden
        >
          <path
            d="M2 4l3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-full">
          <div
            className="absolute -top-1.5 left-5 h-3 w-3 rotate-45 bg-neutral-900"
            aria-hidden
          />
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onListKey}
            className="relative bg-neutral-900 text-white py-2 rounded-sm shadow-lg outline-none"
          >
            {options.map((opt, i) => (
              <li
                key={opt}
                role="option"
                aria-selected={value === opt}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt);
                }}
                className={`px-5 py-2 text-sm font-medium cursor-pointer ${
                  highlight === i ? "bg-neutral-800" : ""
                }`}
              >
                {opt}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "submitting") return null;
  if (status.kind === "success") {
    const verb =
      status.outcome === "created"
        ? "Created"
        : status.outcome === "updated"
          ? "Filled fields on"
          : "Already up to date:";
    return (
      <span className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-1">
        {verb} {status.name}.
      </span>
    );
  }
  return (
    <span
      className="text-xs text-red-800 bg-red-50 border border-red-200 px-2 py-1 max-w-[480px] truncate"
      title={status.message}
    >
      {status.message}
    </span>
  );
}
