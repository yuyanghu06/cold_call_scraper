"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  width?: string; // e.g. "min-w-[180px]"
}

// Button + checkbox popover. Dependency-free; closes on outside click / Esc.
// Summary text: "All" / single value / "3 selected".
export default function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "All",
  width = "min-w-[180px]",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? value[0]
        : `${value.length} selected`;

  function toggle(option: string) {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  }

  function clear() {
    onChange([]);
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="block text-[10px] uppercase tracking-[0.14em] text-neutral-500 mb-1">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${width} border border-neutral-300 px-2 py-1.5 text-sm bg-white hover:border-neutral-900 focus:outline-none focus:border-neutral-900 text-left flex items-center justify-between gap-2`}
      >
        <span
          className={
            value.length === 0 ? "text-neutral-500 truncate" : "text-neutral-900 truncate"
          }
        >
          {summary}
        </span>
        <span className="text-neutral-400 text-[10px] shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 min-w-full max-w-[320px] max-h-[300px] overflow-auto border border-neutral-300 bg-white shadow-sm">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-neutral-200 text-[10px] uppercase tracking-[0.12em] text-neutral-500">
            <span>{value.length} selected</span>
            <button
              type="button"
              onClick={clear}
              disabled={value.length === 0}
              className="hover:text-neutral-900 disabled:opacity-30"
            >
              Clear
            </button>
          </div>
          {options.length === 0 ? (
            <div className="px-2 py-3 text-xs text-neutral-500">
              No options available.
            </div>
          ) : (
            <ul className="py-1">
              {options.map((o) => {
                const checked = value.includes(o);
                return (
                  <li key={o}>
                    <label className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(o)}
                        className="accent-neutral-900"
                      />
                      <span className="truncate">{o}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
