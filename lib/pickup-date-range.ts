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

// Convert a resolved YYYY-MM-DD range into the epoch-ms window for the
// caller's tz. `from` becomes 00:00:00.000 in tz, `to` becomes the end of
// that day (i.e. start of the next day). The returned [startMs, endMs)
// is half-open — callers should use `>= startMs && < endMs`.
export function rangeToEpochMs(
  range: DateRange,
  tz: string,
): { startMs: number; endMs: number } {
  return {
    startMs: ymdStartOfDayInTz(range.from, tz),
    endMs: ymdStartOfDayInTz(addOneDay(range.to), tz),
  };
}

// "YYYY-MM-DD" → epoch ms at the start of that calendar day in `tz`.
//
// Uses Intl `shortOffset` to read the tz's UTC offset at the target
// instant. This is robust to the Node process's own local tz — the older
// `Date.parse(toLocaleString(...))` trick gave different answers when the
// test runner was in NY vs UTC.
function ymdStartOfDayInTz(ymd: string, tz: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d);
  const offsetMs = tzOffsetAt(utcGuess, tz);
  // tz wall-clock 00:00 = UTC instant (utcGuess - offsetMs).
  // For NY/EDT: offset = -4h, utcGuess - (-4h) = utcGuess + 4h, i.e.
  // 2026-04-26T04:00 UTC — which is exactly 2026-04-26T00:00 EDT.
  return utcGuess - offsetMs;
}

function tzOffsetAt(utcMs: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // shortOffset emits "GMT", "GMT-4", "GMT+5:30", etc.
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(tzName);
  if (!m) return 0;
  if (!m[1]) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? "0");
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

function addOneDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

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
