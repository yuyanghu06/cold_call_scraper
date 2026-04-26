// Central source of truth for all Attio display config —
// colors, labels, and palette helpers used across dashboard + components.

export interface StatusColor {
  primary: string; // used for Sankey nodes, chart fills
  bg: string;      // used for badge backgrounds
  text: string;    // used for badge text
}

export const CALL_STATUS_COLORS: Record<string, StatusColor> = {
  "Interested":        { primary: "#22c55e", bg: "#dcfce7", text: "#16a34a" },
  "Demo Booked":       { primary: "#22c55e", bg: "#dcfce7", text: "#16a34a" },
  "Connected":         { primary: "#22c55e", bg: "#dcfce7", text: "#16a34a" },
  "Not Interested":    { primary: "#ef4444", bg: "#fee2e2", text: "#dc2626" },
  "No Decision Maker": { primary: "#eab308", bg: "#fef9c3", text: "#ca8a04" },
  "Callback later":    { primary: "#3b82f6", bg: "#dbeafe", text: "#2563eb" },
  "Send an email":     { primary: "#8b5cf6", bg: "#ede9fe", text: "#7c3aed" },
  "Voicemail":         { primary: "#a78bfa", bg: "#ede9fe", text: "#7c3aed" },
  "No Pick Up":        { primary: "#64748b", bg: "#f1f5f9", text: "#475569" },
  "Unknown":           { primary: "#d1d5db", bg: "#f1f5f9", text: "#94a3b8" },
  "Called":            { primary: "#1a1a1a", bg: "#f1f5f9", text: "#1a1a1a" },
  "Not called yet":    { primary: "#d1d5db", bg: "#f9fafb", text: "#9ca3af" },
};

const FALLBACK: StatusColor = { primary: "#94a3b8", bg: "#f1f5f9", text: "#64748b" };

// Dynamic palette for statuses not in the map above
const OVERFLOW_PALETTE = [
  { primary: "#60a5fa", bg: "#dbeafe", text: "#2563eb" },
  { primary: "#f97316", bg: "#ffedd5", text: "#c2410c" },
  { primary: "#a855f7", bg: "#f3e8ff", text: "#7e22ce" },
  { primary: "#14b8a6", bg: "#ccfbf1", text: "#0f766e" },
  { primary: "#f59e0b", bg: "#fef3c7", text: "#b45309" },
  { primary: "#ec4899", bg: "#fce7f3", text: "#be185d" },
];

const overflowCache = new Map<string, StatusColor>();
let overflowIdx = 0;

export function getStatusColor(status: string): StatusColor {
  if (CALL_STATUS_COLORS[status]) return CALL_STATUS_COLORS[status];
  if (overflowCache.has(status)) return overflowCache.get(status)!;
  const color = OVERFLOW_PALETTE[overflowIdx % OVERFLOW_PALETTE.length];
  overflowIdx++;
  overflowCache.set(status, color);
  return color;
}

export function getStatusPrimary(status: string): string {
  return getStatusColor(status).primary;
}

// Rep colors for stacked bar charts
export const REP_COLORS = [
  "#1a1a1a", "#60a5fa", "#34d399", "#fbbf24",
  "#f87171", "#a78bfa", "#fb923c", "#38bdf8",
];

export function getRepColor(idx: number): string {
  return REP_COLORS[idx % REP_COLORS.length];
}
