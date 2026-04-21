"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "Searching Google Places in parallel…",
  "Deduping results across keywords…",
  "Filtering chains and oversized shops…",
  "Validating phones via Twilio (if enabled)…",
  "Building CSV…",
];

interface Props {
  message?: string | null;
}

export default function ProgressBar({ message }: Props) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIdx((i) => (i + 1) % MESSAGES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const label = message || MESSAGES[idx];

  return (
    <div className="flex items-center gap-3 text-sm text-neutral-600">
      <div className="h-3 w-3 border-2 border-neutral-900 border-t-transparent animate-spin rounded-full" />
      <span>{label}</span>
    </div>
  );
}
