// GET /api/ghl/pickups/today?tz=America/New_York&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Lists every contact whose `booking date` custom field falls inside the
// requested calendar window, regardless of whether they've been tagged
// `picked_up` / `no_pickup` afterward. The iOS app does Pending / Picked
// up / No pickup / All filtering client-side off the contact's `tags`,
// so we have to surface the full set.
//
// Driver:
//   1. Search contacts by tag, three times — the bookings live under one
//      of `calendly-bookings`, `picked_up`, `no_pickup` depending on
//      what's happened to the booking since it was created. The tag-swap
//      routes (/picked-up, /no-pickup) strip `calendly-bookings` when
//      they apply the new outcome, so any single-tag query loses the
//      already-completed records.
//   2. Dedupe by contact id (a contact only ever carries one of the
//      three states, but the union pattern is defensive).
//   3. Filter client-side: keep only contacts whose `contact.booking`
//      custom-field value falls inside the [from, to] window.
//
// Response per contact (additive — older iOS builds ignore unknown keys):
//   { id, name, phone, email, appointmentTime, appointmentNotes, tags,
//     discoverySource: string | null }
//
// `discoverySource` is sourced, in order:
//   1. custom field whose name matches `discovery_source` (case-insensitive),
//   2. the contact's top-level `source` attribute,
//   3. null (also when the value is empty/whitespace).

import { NextResponse } from "next/server";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  bookingDateKeyInTz,
  findCustomFieldByName,
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

// Every state a calendly booking can be in. We search each separately and
// union the results so completed pickups (picked_up / no_pickup) are still
// returned alongside pending ones.
const PICKUP_TAG_STATES = ["calendly-bookings", "picked_up", "no_pickup"] as const;

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

    // Three sequential tag searches (small, ~1s total). We could parallel
    // them but the GHL pacer would serialize the requests anyway.
    const seen = new Set<string>();
    const allContacts: GhlContact[] = [];
    for (const tag of PICKUP_TAG_STATES) {
      try {
        const batch = await searchContactsByTag(tag, locationId);
        for (const c of batch) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          allContacts.push(c);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Tag search for "${tag}" failed: ${message}`);
      }
    }
    console.log(`${LOG} unioned ${allContacts.length} unique contact(s) across tags`);

    let withCustomFields = 0;
    let parseFailures = 0;
    let exampleLogged = false;
    const rows: PickupContact[] = [];

    for (const contact of allContacts) {
      if (contact.customFields && contact.customFields.length > 0) withCustomFields++;
      const raw = readContactCustomField(contact, bookingDateFieldId);
      if (raw === undefined || raw === null || raw === "") continue;

      const dateKey = bookingDateKeyInTz(raw, tz);
      if (dateKey === null) {
        parseFailures++;
        continue;
      }

      // Log one real example so the dev terminal shows the actual storage
      // format — invaluable when the parser misfires on a tz boundary.
      if (!exampleLogged) {
        console.log(
          `${LOG} sample raw=${JSON.stringify(raw)} type=${typeof raw} → dateKey=${dateKey}`,
        );
        exampleLogged = true;
      }

      // YYYY-MM-DD strings sort lexicographically.
      if (dateKey < from || dateKey > to) continue;

      rows.push({
        id: contact.id,
        name: contactName(contact),
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        appointmentTime: appointmentTimeIso(raw, dateKey),
        appointmentNotes: null,
        tags: contact.tags ?? [],
        discoverySource: resolveDiscoverySource(contact),
      });
    }

    if (allContacts.length > 0 && withCustomFields === 0) {
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
