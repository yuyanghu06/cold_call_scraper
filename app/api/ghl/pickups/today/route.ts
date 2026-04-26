// GET /api/ghl/pickups/today?tz=America/New_York
//
// Returns the contacts whose `booking date` custom field falls inside today
// in the requested timezone. One paginated GHL search (filtered to the
// `calendly-bookings` tag), then a client-side filter on the custom-field
// value. No per-contact fan-out, no calendar-events lookup.

import { NextResponse } from "next/server";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  getBookingDateFieldId,
  getLocationId,
  parseDateAsEpochMs,
  readContactCustomField,
  searchContactsByTag,
  type GhlContact,
} from "@/lib/clients/ghlClient";

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

// [start, end) of the local day for `tz` as epoch-ms. Used to bracket the
// booking-date custom-field values, which GHL stores as ms.
function todayBoundsEpochMs(tz: string): { startMs: number; endMs: number } {
  const today = todayKey(tz);
  const startUtcGuess = Date.parse(`${today}T00:00:00Z`);
  const endUtcGuess = startUtcGuess + 24 * 60 * 60 * 1000;
  // Sample tz-local "now" against UTC "now" to derive the offset.
  const tzOffsetMs = (() => {
    const now = new Date();
    const local = Date.parse(
      now.toLocaleString("en-US", { timeZone: tz, hour12: false }),
    );
    if (Number.isNaN(local)) return 0;
    return now.getTime() - local;
  })();
  return {
    startMs: startUtcGuess + tzOffsetMs,
    endMs: endUtcGuess + tzOffsetMs,
  };
}

function contactName(c: GhlContact): string {
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

  const bookingDateFieldId = getBookingDateFieldId();
  if (!bookingDateFieldId) {
    return NextResponse.json(
      { error: "Server is missing GHL_BOOKING_DATE_FIELD_ID — contact an admin." },
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
    const { startMs, endMs } = todayBoundsEpochMs(tz);
    console.log(`${LOG} starting; tz=${tz} window=${startMs}-${endMs}`);

    const contacts = await searchContactsByTag("calendly-bookings", locationId);
    console.log(`${LOG} search returned ${contacts.length} contact(s)`);

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
        name: contactName(contact),
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        appointmentTime: new Date(ms).toISOString(),
        appointmentNotes: null,
        tags: contact.tags ?? [],
      });
    }

    if (contacts.length > 0 && withCustomFields === 0) {
      warnings.push(
        "GHL search returned contacts but none included customFields. The Private Integration token may be missing the custom-fields scope.",
      );
    }
    if (parseFailures > 0) {
      warnings.push(`${parseFailures} contact(s) had unparseable booking-date values.`);
    }

    rows.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));

    console.log(
      `${LOG} done in ${Date.now() - startedAt}ms — matchedToday=${rows.length}`,
    );
    return NextResponse.json({ contacts: rows, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} failed after ${Date.now() - startedAt}ms: ${message}`);
    return NextResponse.json({ error: message, warnings }, { status: 500 });
  }
}
