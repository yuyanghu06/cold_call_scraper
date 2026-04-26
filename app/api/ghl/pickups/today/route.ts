// GET /api/ghl/pickups/today?tz=America/New_York
//
// Returns the contacts whose appointment falls on today in the requested
// timezone, enriched with the booking time + tags for the iOS pickup screen.
//
// Strategies, in order of preference:
//
//   1. (preferred) GHL_BOOKING_DATE_FIELD_ID set — POST /contacts/search
//      filtered to today's window on that custom date field. One call,
//      O(today's bookings), independent of historical tag accumulation.
//
//   2. GHL_CALENDAR_ID set — query /calendars/events directly for today,
//      then look up the contact for each unique booking.
//
//   3. (fallback) tag-based scan, capped at 50 contacts. Only useful for
//      tiny installs; will warn the operator that it's degraded.

import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  getBookingDateFieldId,
  getCalendarEventsInRange,
  getContact,
  getContactAppointments,
  getLocationId,
  getPickupCalendarIds,
  parseDateAsEpochMs,
  readContactCustomField,
  searchContactsByTag,
  type GhlAppointment,
  type GhlContact,
} from "@/lib/clients/ghlClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOG = "[ghl/pickups/today]";
const FALLBACK_MAX_CONTACTS = 50;
const SOFT_BUDGET_MS = 45_000;

interface PickupContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  appointmentTime: string;
  appointmentNotes: string | null;
  tags: string[];
}

function dateKeyInTz(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
}

function todayKey(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Returns the [start, end) of the local day for `tz` as epoch-ms.
function todayBoundsEpochMs(tz: string): { startMs: number; endMs: number } {
  const today = todayKey(tz);
  const startUtcGuess = Date.parse(`${today}T00:00:00Z`);
  const endUtcGuess = Date.parse(`${today}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  const tzOffsetMs = (() => {
    const now = new Date();
    const utc = now.getTime();
    const local = Date.parse(
      now.toLocaleString("en-US", { timeZone: tz, hour12: false }),
    );
    if (Number.isNaN(local)) return 0;
    return utc - local;
  })();
  return {
    startMs: startUtcGuess + tzOffsetMs,
    endMs: endUtcGuess + tzOffsetMs,
  };
}

function contactName(c: GhlContact | null, fallbackId: string): string {
  if (!c) return fallbackId;
  if (c.name && c.name.trim()) return c.name.trim();
  if (c.contactName && c.contactName.trim()) return c.contactName.trim();
  const parts = [c.firstName, c.lastName].filter((p) => p && p.trim()).join(" ");
  return parts || c.email || c.phone || c.id;
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

  let locationId: string;
  try {
    locationId = getLocationId();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const bookingDateFieldId = getBookingDateFieldId();
  const calendarIds = getPickupCalendarIds();
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const warnings: string[] = [];

  try {
    if (bookingDateFieldId) {
      console.log(
        `${LOG} starting booking-date path; tz=${tz} fieldId=${bookingDateFieldId}`,
      );
      const result = await runBookingDatePath({
        bookingDateFieldId,
        locationId,
        tz,
        warnings,
      });
      console.log(`${LOG} done in ${elapsed()}ms — matchedToday=${result.length}`);
      return NextResponse.json({ contacts: result, warnings });
    }

    if (calendarIds.length > 0) {
      console.log(
        `${LOG} starting calendar path; tz=${tz} calendars=${calendarIds.length}`,
      );
      const result = await runCalendarPath({
        calendarIds,
        locationId,
        tz,
        warnings,
      });
      console.log(`${LOG} done in ${elapsed()}ms — matchedToday=${result.length}`);
      return NextResponse.json({ contacts: result, warnings });
    }

    console.log(`${LOG} starting tag fallback; tz=${tz}`);
    warnings.push(
      "Set GHL_BOOKING_DATE_FIELD_ID for the supported fast path. Falling back to tag-based scan, capped to "
        + `${FALLBACK_MAX_CONTACTS} contacts.`,
    );
    const result = await runTagFallback({
      locationId,
      tz,
      warnings,
      elapsed,
    });
    console.log(`${LOG} done in ${elapsed()}ms — matchedToday=${result.length}`);
    return NextResponse.json({ contacts: result, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} failed after ${elapsed()}ms: ${message}`);
    return NextResponse.json({ error: message, warnings }, { status: 500 });
  }
}

async function runBookingDatePath(args: {
  bookingDateFieldId: string;
  locationId: string;
  tz: string;
  warnings: string[];
}): Promise<PickupContact[]> {
  const { bookingDateFieldId, locationId, tz, warnings } = args;
  const { startMs, endMs } = todayBoundsEpochMs(tz);

  // GHL v2 won't accept a raw custom-field id as a top-level `field` in
  // /contacts/search filters, and the alternate syntaxes vary by GHL
  // version. Fetching all calendly-bookings contacts is one cheap call (we
  // measured ~800ms for 320 contacts) — we then filter on the booking-date
  // custom field client-side. No per-contact fan-out.
  const tagStart = Date.now();
  const contacts = await searchContactsByTag("calendly-bookings", locationId);
  console.log(
    `${LOG} tag search returned ${contacts.length} contact(s) in ${Date.now() - tagStart}ms`,
  );

  let withCustomFields = 0;
  let parseFailures = 0;
  const rows: PickupContact[] = [];
  for (const contact of contacts) {
    if (contact.customFields && contact.customFields.length > 0) withCustomFields++;
    const raw = readContactCustomField(contact, bookingDateFieldId);
    if (raw === undefined || raw === null || raw === "") continue;
    const ms = parseDateAsEpochMs(raw);
    if (ms === null) {
      parseFailures++;
      continue;
    }
    if (ms < startMs || ms >= endMs) continue;
    rows.push({
      id: contact.id,
      name: contactName(contact, contact.id),
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      appointmentTime: new Date(ms).toISOString(),
      appointmentNotes: null,
      tags: contact.tags ?? [],
    });
  }

  if (contacts.length > 0 && withCustomFields === 0) {
    warnings.push(
      "GHL search returned contacts but none included customFields. The token may need 'contacts.readonly' with custom-field scope, or POST /contacts/search isn't returning custom fields on this account.",
    );
  }
  if (parseFailures > 0) {
    warnings.push(`${parseFailures} contact(s) had unparseable booking-date values.`);
  }

  rows.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  return rows;
}

async function runCalendarPath(args: {
  calendarIds: string[];
  locationId: string;
  tz: string;
  warnings: string[];
}): Promise<PickupContact[]> {
  const { calendarIds, locationId, tz, warnings } = args;
  const { startMs, endMs } = todayBoundsEpochMs(tz);

  const limit = pLimit(2);
  const eventBatches = await Promise.all(
    calendarIds.map((cid) =>
      limit(async (): Promise<GhlAppointment[]> => {
        try {
          return await getCalendarEventsInRange(cid, locationId, startMs, endMs);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Calendar ${cid} fetch failed: ${message}`);
          return [];
        }
      }),
    ),
  );

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

  if (earliestByContact.size === 0) return [];

  const contactLimit = pLimit(5);
  const contactEntries = Array.from(earliestByContact.entries());
  const enriched = await Promise.all(
    contactEntries.map(([cid, event]) =>
      contactLimit(async (): Promise<PickupContact | null> => {
        let contact: GhlContact | null = null;
        try {
          contact = await getContact(cid, locationId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Contact ${cid} lookup failed: ${message}`);
        }
        return {
          id: cid,
          name: contactName(contact, cid),
          phone: contact?.phone ?? null,
          email: contact?.email ?? null,
          appointmentTime: event.startTime,
          appointmentNotes: event.notes ?? null,
          tags: contact?.tags ?? [],
        };
      }),
    ),
  );

  const filtered = enriched.filter((p): p is PickupContact => p !== null);
  filtered.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  return filtered;
}

async function runTagFallback(args: {
  locationId: string;
  tz: string;
  warnings: string[];
  elapsed: () => number;
}): Promise<PickupContact[]> {
  const { locationId, tz, warnings, elapsed } = args;
  const searchStart = Date.now();
  const contacts = await searchContactsByTag("calendly-bookings", locationId);
  console.log(
    `${LOG} contact search returned ${contacts.length} contact(s) in ${
      Date.now() - searchStart
    }ms`,
  );

  let toScan = contacts;
  if (contacts.length > FALLBACK_MAX_CONTACTS) {
    warnings.push(
      `Truncated to first ${FALLBACK_MAX_CONTACTS} of ${contacts.length} 'calendly-bookings' contacts.`,
    );
    toScan = contacts.slice(0, FALLBACK_MAX_CONTACTS);
  }

  const today = todayKey(tz);
  const limit = pLimit(5);
  let scanned = 0;
  let appointmentErrors = 0;
  let budgetHit = false;

  const enriched = await Promise.all(
    toScan.map((contact) =>
      limit(async (): Promise<PickupContact | null> => {
        if (elapsed() > SOFT_BUDGET_MS) {
          budgetHit = true;
          return null;
        }
        let appointments: GhlAppointment[] = [];
        try {
          appointments = await getContactAppointments(contact.id, locationId);
        } catch (err) {
          appointmentErrors++;
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `${LOG} appointments failed for contact=${contact.id}: ${message}`,
          );
          return null;
        }
        scanned++;
        const todays = appointments.filter(
          (a) => a.startTime && dateKeyInTz(a.startTime, tz) === today,
        );
        if (todays.length === 0) return null;
        todays.sort((a, b) => a.startTime.localeCompare(b.startTime));
        const appt = todays[0];
        return {
          id: contact.id,
          name: contactName(contact, contact.id),
          phone: contact.phone ?? null,
          email: contact.email ?? null,
          appointmentTime: appt.startTime,
          appointmentNotes: appt.notes ?? null,
          tags: contact.tags ?? [],
        };
      }),
    ),
  );

  if (budgetHit) {
    warnings.push(
      `Hit ${SOFT_BUDGET_MS}ms wall-clock budget after scanning ${scanned}/${toScan.length} contacts.`,
    );
  }
  if (appointmentErrors > 0) {
    warnings.push(`${appointmentErrors} contact appointment lookup(s) failed.`);
  }

  const filtered = enriched.filter((p): p is PickupContact => p !== null);
  filtered.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
  return filtered;
}
