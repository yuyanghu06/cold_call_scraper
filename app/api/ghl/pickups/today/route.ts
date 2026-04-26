// GET /api/ghl/pickups/today?tz=America/New_York&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Lists every contact with an appointment in the requested calendar window,
// regardless of whether they've been tagged `picked_up` / `no_pickup`. The
// iOS app does the Pending / Picked up / No pickup / All filtering client-
// side off the contact's `tags` array, so we have to surface the full set.
//
// Driver: GHL `/calendars/events` for each configured calendar id, scoped
// by epoch-ms window in the caller's tz. Each event's contactId resolves
// to a full contact lookup (tags + customFields + top-level source).
//
// Response per contact (additive — older iOS builds ignore unknown keys):
//   { id, name, phone, email, appointmentTime, appointmentNotes, tags,
//     discoverySource: string | null }
//
// `discoverySource` is sourced, in order:
//   1. custom field whose name matches `discovery_source` (case-insensitive),
//   2. the contact's top-level `source` attribute,
//   3. null (also when the value is empty/whitespace).
//
// Backwards-compat: with no `from`/`to`, the window is today/today in tz.

import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  findCustomFieldByName,
  getCalendarEvents,
  getContact,
  getLocationId,
  getPickupCalendarIds,
  type GhlAppointment,
  type GhlContact,
} from "@/lib/clients/ghlClient";
import { rangeToEpochMs, resolveRange } from "@/lib/pickup-date-range";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOG = "[ghl/pickups/today]";

interface PickupContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  appointmentTime: string;
  appointmentNotes: string | null;
  tags: string[];
  discoverySource: string | null;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function contactName(c: GhlContact): string {
  if (c.name && c.name.trim()) return c.name.trim();
  if (c.contactName && c.contactName.trim()) return c.contactName.trim();
  const parts = [c.firstName, c.lastName].filter((p) => p && p.trim()).join(" ");
  return parts || c.email || c.phone || c.id;
}

function normalizeDiscoveryValue(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = typeof raw === "string" ? raw : String(raw);
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed;
}

function resolveDiscoverySource(c: GhlContact): string | null {
  const fromCustom = normalizeDiscoveryValue(
    findCustomFieldByName(c, "discovery_source"),
  );
  if (fromCustom !== null) return fromCustom;
  return normalizeDiscoveryValue(c.source);
}

export async function GET(req: Request) {
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const tz = url.searchParams.get("tz") ?? "UTC";
  if (!isValidTimeZone(tz)) {
    return NextResponse.json({ error: `Invalid tz: ${tz}` }, { status: 400 });
  }

  const rangeResult = resolveRange(
    url.searchParams.get("from"),
    url.searchParams.get("to"),
    tz,
  );
  if (!rangeResult.ok) {
    return NextResponse.json({ error: rangeResult.error }, { status: 400 });
  }
  const { from, to } = rangeResult.range;
  const { startMs, endMs } = rangeToEpochMs(rangeResult.range, tz);

  const calendarIds = getPickupCalendarIds();
  if (calendarIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Server is missing GHL_CALENDAR_ID — set it (single id or comma-separated). Without it, this route would surface every event in the location, including unrelated calendars.",
      },
      { status: 500 },
    );
  }

  let locationId: string;
  try {
    locationId = getLocationId();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const startedAt = Date.now();
  const warnings: string[] = [];

  try {
    console.log(
      `${LOG} starting; tz=${tz} from=${from} to=${to} window=${startMs}-${endMs} calendars=${calendarIds.length}`,
    );

    const eventLimit = pLimit(2);
    const eventBatches = await Promise.all(
      calendarIds.map((cid) =>
        eventLimit(async (): Promise<GhlAppointment[]> => {
          try {
            return await getCalendarEvents(cid, locationId, startMs, endMs);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            warnings.push(`Calendar ${cid} fetch failed: ${message}`);
            return [];
          }
        }),
      ),
    );

    // One row per contact; keep their earliest event in the window for
    // appointmentTime / appointmentNotes.
    const earliestByContact = new Map<string, GhlAppointment>();
    for (const batch of eventBatches) {
      for (const event of batch) {
        const cid = event.contactId;
        if (!cid || !event.startTime) continue;
        const existing = earliestByContact.get(cid);
        if (!existing || event.startTime < existing.startTime) {
          earliestByContact.set(cid, event);
        }
      }
    }

    if (earliestByContact.size === 0) {
      console.log(`${LOG} no events in window — done in ${Date.now() - startedAt}ms`);
      return NextResponse.json({ contacts: [], warnings });
    }

    const contactLimit = pLimit(5);
    const entries = Array.from(earliestByContact.entries());
    const enriched = await Promise.all(
      entries.map(([cid, event]) =>
        contactLimit(async (): Promise<PickupContact | null> => {
          let contact: GhlContact | null = null;
          try {
            contact = await getContact(cid, locationId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            warnings.push(`Contact ${cid} lookup failed: ${message}`);
          }
          // Use whatever contact info we have, plus the event metadata.
          // If the contact lookup outright failed, we still include the row
          // (with empty enrichment) so the iOS app can render the
          // appointment — the caller can still complete the pickup action.
          return {
            id: cid,
            name: contact ? contactName(contact) : cid,
            phone: contact?.phone ?? null,
            email: contact?.email ?? null,
            appointmentTime: event.startTime,
            appointmentNotes: event.notes ?? null,
            tags: contact?.tags ?? [],
            discoverySource: contact ? resolveDiscoverySource(contact) : null,
          };
        }),
      ),
    );

    const rows = enriched.filter((p): p is PickupContact => p !== null);
    rows.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));

    console.log(
      `${LOG} done in ${Date.now() - startedAt}ms — events=${[...earliestByContact.values()].length} contacts=${rows.length}`,
    );
    return NextResponse.json({ contacts: rows, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} failed after ${Date.now() - startedAt}ms: ${message}`);
    return NextResponse.json({ error: message, warnings }, { status: 500 });
  }
}
