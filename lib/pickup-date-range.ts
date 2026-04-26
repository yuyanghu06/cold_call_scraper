// Resolve the optional `from`/`to` query params on /api/ghl/pickups/today
// into a concrete YYYY-MM-DD window in the caller's timezone.

const MAX_RANGE_DAYS = 60;

export interface DateRange {
  from: string;
  to: string;
}

export type DateRangeResult =
  | { ok: true; range: DateRange }
  | { ok: false; error: string };

function todayKey(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

// Strict YYYY-MM-DD parse. Rejects "2026-13-01", "2026-02-30", trailing
// junk, etc. Returns the canonical string on success, null on bad input.
function parseYmdStrict(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [ys, ms, ds] = trimmed.split("-");
  const y = Number(ys), m = Number(ms), d = Number(ds);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return trimmed;
}

function ymdDiffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

// Resolve the optional from/to query params into a concrete window.
//
//   both omitted → today/today (in tz)
//   only `from`  → to = from (single-day query)
//   only `to`    → 400, ambiguous
//   both set     → use them, validate ordering and width
export function resolveRange(
  fromRaw: string | null,
  toRaw: string | null,
  tz: string,
): DateRangeResult {
  if (toRaw !== null && fromRaw === null) {
    return { ok: false, error: "`to` requires `from`." };
  }

  if (fromRaw === null && toRaw === null) {
    const today = todayKey(tz);
    return { ok: true, range: { from: today, to: today } };
  }

  // fromRaw is non-null at this point.
  const from = parseYmdStrict(fromRaw!);
  if (from === null) {
    return { ok: false, error: `\`from\` must be YYYY-MM-DD; got "${fromRaw}".` };
  }

  let to: string;
  if (toRaw === null) {
    to = from;
  } else {
    const parsed = parseYmdStrict(toRaw);
    if (parsed === null) {
      return { ok: false, error: `\`to\` must be YYYY-MM-DD; got "${toRaw}".` };
    }
    to = parsed;
  }

  if (from > to) {
    return { ok: false, error: "`from` must be on or before `to`." };
  }

  const span = ymdDiffDays(from, to) + 1; // inclusive
  if (span > MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `Range is ${span} days; max is ${MAX_RANGE_DAYS}.`,
    };
  }

  return { ok: true, range: { from, to } };
}
