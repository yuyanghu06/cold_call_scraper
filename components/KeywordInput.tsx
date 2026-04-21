"use client";

import { useState } from "react";

interface Props {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export default function KeywordInput({
  label,
  values,
  onChange,
  placeholder,
  ariaLabel,
}: Props) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) {
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) {
        next.push(p);
      }
    }
    onChange(next);
    setDraft("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  function remove(i: number) {
    const next = values.filter((_, idx) => idx !== i);
    onChange(next);
  }

  return (
    <div>
      <label className="block text-[11px] uppercase tracking-[0.14em] text-neutral-500 mb-1.5">
        {label}
      </label>
      <div
        className="flex flex-wrap gap-1.5 border border-neutral-300 px-2 py-1.5 bg-white focus-within:border-neutral-900"
        role="group"
        aria-label={ariaLabel || label}
      >
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 bg-neutral-900 text-white text-xs px-2 py-0.5"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-neutral-400 hover:text-white leading-none"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] text-sm px-1 py-0.5 outline-none bg-transparent"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft && commit(draft)}
        />
      </div>
    </div>
  );
}
