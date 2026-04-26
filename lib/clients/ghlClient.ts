// GoHighLevel (LeadConnector) API client.
//
// We use the v1 contact endpoints because they're stable and well-documented.
// API requires a `Version` header (currently "2021-07-28") on every call.
// We rate-limit to 10 req/sec — GHL's documented public limit.

import { createPacer, parseRetryAfter } from "@/lib/clients/attioClient";

const DEFAULT_BASE = "https://services.leadconnectorhq.com";
const VERSION_HEADER = "2021-07-28";
const RATE_PER_SEC = 10;
const PACE_INTERVAL_MS = Math.ceil(1000 / RATE_PER_SEC);
const MAX_ATTEMPTS = 4;
// Per-request abort so a stalled GHL response doesn't pin the route up to
// Vercel's 60s function timeout. Tight enough that even if every attempt
// times out we throw before iOS's 60s URLSession timeout fires.
const REQUEST_TIMEOUT_MS = 6_000;
// Don't retry an aborted request — if upstream isn't responding within 6s,
// retrying just burns the route's budget. Network errors (TypeError) still
// retry once.
const MAX_RETRIES_ON_TIMEOUT = 0;
const MAX_RETRIES_ON_NETERR = 1;

const pace = createPacer(PACE_INTERVAL_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey(): string {
  const raw = process.env.GHL_API_KEY;
  if (!raw || !raw.trim()) throw new Error("GHL_API_KEY is not set");
  return raw.trim();
}

function getBaseUrl(): string {
  return process.env.GHL_API_BASE?.trim() || DEFAULT_BASE;
}

export function getLocationId(): string {
  const raw = process.env.GHL_LOCATION_ID;
  if (!raw || !raw.trim()) throw new Error("GHL_LOCATION_ID is not set");
  return raw.trim();
}

// Custom-field id on GHL Contacts representing the appointment / booking
// date. /api/ghl/pickups/today filters on this client-side after pulling
// calendly-bookings tagged contacts.
export function getBookingDateFieldId(): string | null {
  const raw = process.env.GHL_BOOKING_DATE_FIELD_ID;
  if (!raw || !raw.trim()) return null;
  return raw.trim();
}

export async function ghlRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const apiKey = getApiKey();
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const serialized = body === undefined ? undefined : JSON.stringify(body);

  let timeoutAttempts = 0;
  let netErrAttempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pace();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          Version: VERSION_HEADER,
        },
        body: serialized,
        signal: ctl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as { name?: string })?.name === "AbortError";
      const isLast = attempt === MAX_ATTEMPTS;
      if (aborted && timeoutAttempts < MAX_RETRIES_ON_TIMEOUT && !isLast) {
        timeoutAttempts++;
        continue;
      }
      if (!aborted && err instanceof TypeError && netErrAttempts < MAX_RETRIES_ON_NETERR && !isLast) {
        netErrAttempts++;
        await sleep(500);
        continue;
      }
      const reason = aborted ? `timeout after ${REQUEST_TIMEOUT_MS}ms` : err instanceof Error ? err.message : String(err);
      throw new Error(`GHL ${method} ${path} failed: ${reason}`);
    }
    clearTimeout(timer);
    if (res.ok) return res;

    const isLast = attempt === MAX_ATTEMPTS;
    if (res.status === 429 && !isLast) {
      await sleep(parseRetryAfter(res.headers.get("retry-after"), 2000));
      continue;
    }
    if (res.status >= 500 && res.status < 600 && !isLast) {
      await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`GHL ${res.status} on ${method} ${path}: ${text.slice(0, 240)}`);
  }
  throw new Error("GHL: retries exhausted");
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  locationId?: string;
  // Top-level GHL contact attribute. Used as a fallback when a discovery
  // source custom field isn't set on the contact.
  source?: string;
  // v2 shape (services.leadconnectorhq.com): { id, value, name? }
  customFields?: Array<{ id?: string; value?: unknown; name?: string }>;
  // v1 shape (rest.gohighlevel.com): { id, fieldKey, value }. We support
  // it because some GHL accounts still surface this on contact responses.
  customField?: Array<{ id?: string; value?: unknown; fieldKey?: string }>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

interface SearchContactsResponse {
  contacts?: GhlContact[];
  total?: number;
}

// Filter contacts by tag using v2's POST /contacts/search. The previous
// implementation passed `query=<tag>` to GET /contacts/, which is a free-text
// search over name/phone/email — wrong, and slow enough to time out.
//
// Pagination: GHL caps `pageLimit` at 100 and uses 1-based `page`. We bail
// out as soon as we've seen `total` (or 10 pages, defensively).
export async function searchContactsByTag(
  tag: string,
  locationId: string,
): Promise<GhlContact[]> {
  const out: GhlContact[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    const t0 = Date.now();
    const res = await ghlRequest("POST", "/contacts/search", {
      locationId,
      pageLimit: 100,
      page,
      filters: [
        { field: "tags", operator: "contains", value: tag },
      ],
    });
    const json = (await res.json()) as SearchContactsResponse;
    const batch = json.contacts ?? [];
    console.log(
      `[ghl] /contacts/search page=${page} got=${batch.length} total=${
        json.total ?? "?"
      } in ${Date.now() - t0}ms`,
    );
    for (const c of batch) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    if (batch.length < 100) break;
    if (typeof json.total === "number" && out.length >= json.total) break;
  }
  return out;
}

// Read a single custom-field value from a contact. The shape on v2 contacts
// is `customFields: [{ id, value, ... }]`; this helper just looks up by id.
export function readContactCustomField(
  contact: GhlContact,
  fieldId: string,
): unknown {
  const fields = contact.customFields ?? [];
  for (const f of fields) {
    if (f?.id === fieldId) return f.value;
  }
  return undefined;
}

// Look up a custom-field value by the field's *name*, case-insensitively.
// Handles both shapes a GHL contact response can carry:
//   v2: `customFields: [{ id, name?, value }]`  — name may be present
//   v1: `customField:  [{ id, fieldKey, value }]` — fieldKey is the slug
// Returns the raw value (any type) or undefined if no match.
export function findCustomFieldByName(
  contact: GhlContact,
  fieldName: string,
): unknown {
  const target = fieldName.toLowerCase();
  if (contact.customFields) {
    for (const f of contact.customFields) {
      const name = typeof f?.name === "string" ? f.name.toLowerCase() : null;
      if (name === target) return f.value;
    }
  }
  if (contact.customField) {
    for (const f of contact.customField) {
      const key = typeof f?.fieldKey === "string" ? f.fieldKey.toLowerCase() : null;
      if (key === target) return f.value;
    }
  }
  return undefined;
}

// Best-effort: parse a custom-field date value into epoch ms. GHL stores
// these as numbers (ms), numeric strings, or ISO strings depending on the
// field type and how the integration set it.
export function parseDateAsEpochMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

// Calendar-date key (YYYY-MM-DD) for a custom-field value. The semantics
// differ by storage format:
//
//   - "YYYY-MM-DD" string  → that calendar date verbatim. Tz is irrelevant.
//   - ms at exactly UTC midnight (n % 86_400_000 === 0) → GHL's storage
//     for a date-typed custom field. Format as UTC, NOT the caller's tz —
//     otherwise a "2026-04-27" booking reads as 2026-04-26 in NY because
//     UTC midnight is the previous evening locally.
//   - any other instant (ms or ISO with time) → project into the caller's
//     tz and format. This is the right call for datetime-typed fields.
//
// Returns null on unparseable values.
export function bookingDateKeyInTz(raw: unknown, tz: string): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  const ms = parseDateAsEpochMs(raw);
  if (ms === null) return null;
  const isUtcMidnight = ms % 86_400_000 === 0;
  return new Date(ms).toLocaleDateString("en-CA", {
    timeZone: isUtcMidnight ? "UTC" : tz,
  });
}

interface TagMutationResponse {
  tags?: string[];
}

export async function addTagToContact(
  contactId: string,
  tag: string,
  _locationId: string,
): Promise<string[]> {
  const res = await ghlRequest(
    "POST",
    `/contacts/${encodeURIComponent(contactId)}/tags`,
    { tags: [tag] },
  );
  const json = (await res.json()) as TagMutationResponse;
  return json.tags ?? [];
}

export async function removeTagFromContact(
  contactId: string,
  tag: string,
  _locationId: string,
): Promise<string[]> {
  const res = await ghlRequest(
    "DELETE",
    `/contacts/${encodeURIComponent(contactId)}/tags`,
    { tags: [tag] },
  );
  const json = (await res.json()) as TagMutationResponse;
  return json.tags ?? [];
}

// Atomically swap a contact's calendly outcome. Removes `calendly-bookings`
// and the opposite outcome tag, then adds the target tag. Idempotent —
// removing a non-existent tag is a no-op on GHL's side.
export async function swapCalendlyTags(
  contactId: string,
  outcome: "picked_up" | "no_pickup",
  locationId: string,
): Promise<string[]> {
  const opposite = outcome === "picked_up" ? "no_pickup" : "picked_up";
  await removeTagFromContact(contactId, "calendly-bookings", locationId);
  await removeTagFromContact(contactId, opposite, locationId);
  return addTagToContact(contactId, outcome, locationId);
}

interface LocationResponse {
  location?: unknown;
  id?: string;
  name?: string;
}

export async function getLocation(
  locationId: string,
): Promise<LocationResponse> {
  const res = await ghlRequest(
    "GET",
    `/locations/${encodeURIComponent(locationId)}`,
  );
  return (await res.json()) as LocationResponse;
}
