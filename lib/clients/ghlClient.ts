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

export async function ghlRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const apiKey = getApiKey();
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const serialized = body === undefined ? undefined : JSON.stringify(body);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pace();
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        Version: VERSION_HEADER,
      },
      body: serialized,
    });
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
}

export interface GhlAppointment {
  id: string;
  contactId: string;
  title?: string;
  startTime: string;        // ISO 8601
  endTime?: string;
  appointmentStatus?: string;
  notes?: string;
  calendarId?: string;
  locationId?: string;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

interface ContactsListResponse {
  contacts?: GhlContact[];
  meta?: { nextPageUrl?: string | null; total?: number; startAfterId?: string | null };
}

// GHL's `/contacts/` endpoint paginates with `startAfterId`. We pull all
// pages tagged with the given tag — should be small (one calendar's-worth of
// upcoming appointments), but cap at 1000 just in case.
export async function searchContactsByTag(
  tag: string,
  locationId: string,
): Promise<GhlContact[]> {
  const out: GhlContact[] = [];
  let startAfterId: string | null | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      locationId,
      query: tag,
      limit: "100",
    });
    if (startAfterId) params.set("startAfterId", startAfterId);
    const res = await ghlRequest("GET", `/contacts/?${params.toString()}`);
    const json = (await res.json()) as ContactsListResponse;
    const batch = json.contacts ?? [];
    // The `query` parameter is a free-text search over name/email/phone, not
    // a tag filter. We post-filter to contacts that actually carry the tag.
    for (const c of batch) {
      if ((c.tags ?? []).map((t) => t.toLowerCase()).includes(tag.toLowerCase())) {
        out.push(c);
      }
    }
    const next = json.meta?.startAfterId;
    if (!next || batch.length === 0) break;
    startAfterId = next;
  }
  return out;
}

interface AppointmentsResponse {
  events?: GhlAppointment[];
  appointments?: GhlAppointment[];
}

export async function getContactAppointments(
  contactId: string,
  _locationId: string,
): Promise<GhlAppointment[]> {
  // `/contacts/{id}/appointments` returns the contact's appointments. The
  // locationId scoping is implied by the contact.
  const res = await ghlRequest(
    "GET",
    `/contacts/${encodeURIComponent(contactId)}/appointments`,
  );
  const json = (await res.json()) as AppointmentsResponse;
  return json.events ?? json.appointments ?? [];
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
