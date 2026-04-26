// GET /api/ghl/pickups/today?tz=America/New_York
//
// Returns the contacts tagged `calendly-bookings` whose appointment falls on
// today in the requested timezone. Each contact gets enriched with the
// matching appointment time + notes for the iOS pickup screen.
//
// Diagnostics: every phase logs `[ghl/pickups/today] …` to the server console
// so the dev terminal (or Vercel logs) shows where time goes. We also cap the
// per-contact appointment lookups and bail early if we burn through a soft
// 45s budget — better to return what we have with a warning than to let the
// iOS client see a blanket transport timeout.

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

const LOG = "[ghl/pickups/today]";
// Hard cap on per-contact appointment lookups. At 10 req/sec, 200 lookups
// already takes ~20s — anything bigger and we're guaranteed to time out.
const MAX_CONTACTS_TO_SCAN = 200;
// Soft wall-clock budget per request. Leaves headroom under Vercel's 60s.
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

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const warnings: string[] = [];

  try {
    console.log(`${LOG} starting; tz=${tz} location=${locationId}`);
    const searchStart = Date.now();
    const contacts = await searchContactsByTag("calendly-bookings", locationId);
    console.log(
      `${LOG} contact search returned ${contacts.length} contact(s) in ${
        Date.now() - searchStart
      }ms`,
    );

    let toScan = contacts;
    if (contacts.length > MAX_CONTACTS_TO_SCAN) {
      warnings.push(
        `Truncated to first ${MAX_CONTACTS_TO_SCAN} of ${contacts.length} 'calendly-bookings' contacts. The tag is likely cumulative; consider scoping by recent activity or by calendar.`,
      );
      toScan = contacts.slice(0, MAX_CONTACTS_TO_SCAN);
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

    if (budgetHit) {
      warnings.push(
        `Hit ${SOFT_BUDGET_MS}ms wall-clock budget after scanning ${scanned}/${toScan.length} contacts; results may be incomplete.`,
      );
    }
    if (appointmentErrors > 0) {
      warnings.push(`${appointmentErrors} contact appointment lookup(s) failed.`);
    }

    const filtered = enriched.filter((p): p is PickupContact => p !== null);
    filtered.sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));

    console.log(
      `${LOG} done in ${elapsed()}ms — scanned=${scanned} matchedToday=${filtered.length} errors=${appointmentErrors}${
        budgetHit ? " (budget hit)" : ""
      }`,
    );
    return NextResponse.json({ contacts: filtered, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} failed after ${elapsed()}ms: ${message}`);
    return NextResponse.json({ error: message, warnings }, { status: 500 });
  }
}
