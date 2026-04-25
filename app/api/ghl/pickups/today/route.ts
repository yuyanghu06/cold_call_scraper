// GET /api/ghl/pickups/today?tz=America/New_York
//
// Returns the contacts tagged `calendly-bookings` whose appointment falls on
// today in the requested timezone. Each contact gets enriched with the
// matching appointment time + notes for the iOS pickup screen.

import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import {
  getContactAppointments,
  getLocationId,
  searchContactsByTag,
  type GhlAppointment,
  type GhlContact,
} from "@/lib/clients/ghlClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  // en-CA gives YYYY-MM-DD reliably across runtimes.
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

  let locationId: string;
  try {
    locationId = getLocationId();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const contacts = await searchContactsByTag("calendly-bookings", locationId);
    const today = todayKey(tz);

    const limit = pLimit(5);
    const enriched = await Promise.all(
      contacts.map((contact) =>
        limit(async (): Promise<PickupContact | null> => {
          let appointments: GhlAppointment[] = [];
          try {
            appointments = await getContactAppointments(contact.id, locationId);
          } catch {
            return null;
          }
          const todays = appointments.filter(
            (a) => a.startTime && dateKeyInTz(a.startTime, tz) === today,
          );
          if (todays.length === 0) return null;
          // Pick the earliest of today's appointments.
          todays.sort((a, b) => a.startTime.localeCompare(b.startTime));
          const appt = todays[0];
          return {
            id: contact.id,
            name: contactName(contact),
            phone: contact.phone ?? null,
            email: contact.email ?? null,
            appointmentTime: appt.startTime,
            appointmentNotes: appt.notes ?? null,
            tags: contact.tags ?? [],
          };
        }),
      ),
    );

    const filtered = enriched.filter((p): p is PickupContact => p !== null);
    filtered.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
    return NextResponse.json({ contacts: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
