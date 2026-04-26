// GET /api/ghl/pickups/today?tz=America/New_York&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns the contacts whose `booking date` custom field falls inside the
// requested calendar-date window in the caller's timezone. One paginated GHL
// search (filtered to the `calendly-bookings` tag), then a client-side
// date-string range comparison.
//
// Backwards-compat: with no `from`/`to`, the window is today/today (the
// original behavior). The route name stays for older iOS builds.

import { NextResponse } from "next/server";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  bookingDateKeyInTz,
  getBookingDateFieldId,
  getLocationId,
  parseDateAsEpochMs,
  readContactCustomField,
  searchContactsByTag,
  type GhlContact,
} from "@/lib/clients/ghlClient";
import { resolveRange } from "@/lib/pickup-date-range";

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

// Build the iOS-facing `appointmentTime` for a contact. We always return an
// ISO string, but the underlying storage format varies (date-only string,
// UTC-midnight ms, or a real instant), so we render the most accurate ISO
// we can from each.
function appointmentTimeIso(raw: unknown, dateKey: string): string {
  const ms = parseDateAsEpochMs(raw);
  if (ms !== null) return new Date(ms).toISOString();
  return `${dateKey}T00:00:00.000Z`;
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
    console.log(`${LOG} starting; tz=${tz} from=${from} to=${to}`);

    const contacts = await searchContactsByTag("calendly-bookings", locationId);
    console.log(`${LOG} search returned ${contacts.length} contact(s)`);

    let withCustomFields = 0;
    let parseFailures = 0;
    let exampleLogged = false;
    const rows: PickupContact[] = [];

    for (const contact of contacts) {
      if (contact.customFields && contact.customFields.length > 0) withCustomFields++;
      const raw = readContactCustomField(contact, bookingDateFieldId);
      if (raw === undefined || raw === null || raw === "") continue;

      const dateKey = bookingDateKeyInTz(raw, tz);
      if (dateKey === null) {
        parseFailures++;
        continue;
      }

      if (!exampleLogged) {
        console.log(
          `${LOG} sample raw=${JSON.stringify(raw)} type=${typeof raw} → dateKey=${dateKey}`,
        );
        exampleLogged = true;
      }

      // YYYY-MM-DD strings sort lexicographically; range check is two
      // string comparisons.
      if (dateKey < from || dateKey > to) continue;

      rows.push({
        id: contact.id,
        name: contactName(contact),
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        appointmentTime: appointmentTimeIso(raw, dateKey),
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
      `${LOG} done in ${Date.now() - startedAt}ms — matched=${rows.length}`,
    );
    return NextResponse.json({ contacts: rows, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} failed after ${Date.now() - startedAt}ms: ${message}`);
    return NextResponse.json({ error: message, warnings }, { status: 500 });
  }
}
