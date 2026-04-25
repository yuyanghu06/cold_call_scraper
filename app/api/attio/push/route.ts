import { NextResponse } from "next/server";
import { pushPlacesToAttio } from "@/lib/services/attioService";
import { gateAttioFromRequest } from "@/lib/mobileAuth";
import { enrichPlacesWithIndustry } from "@/lib/services/enrichmentService";
import { fillMissingPlaceCoords } from "@/lib/services/geocodeService";
import type { Place } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await gateAttioFromRequest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const places = Array.isArray(b.places) ? (b.places as Place[]) : null;
  const keywords = Array.isArray(b.keywords)
    ? b.keywords.filter((k): k is string => typeof k === "string")
    : [];
  const caller = typeof b.caller === "string" && b.caller.trim() ? b.caller.trim() : null;

  if (!places || places.length === 0)
    return NextResponse.json({ error: "places array required" }, { status: 400 });

  try {
    const enrichment = await enrichPlacesWithIndustry(places, keywords);
    // Google Places sometimes returns a business without lat/lng; fill those
    // in via Nominatim so Attio's primary_location gets the structured
    // coordinates (its schema requires finite lat/lng).
    const nominatimUA = process.env.NOMINATIM_USER_AGENT;
    const geocodeWarnings: string[] = [];
    if (nominatimUA) {
      // Cap at 120 geocodes per push. At the 2s/request pace in
      // fillMissingPlaceCoords, that's ~240s — fits under our 300s
      // maxDuration with a 60s buffer for the actual Attio writes. Google
      // Places returns coords for the vast majority of businesses, so
      // coord-less ones are typically a small tail.
      const geo = await fillMissingPlaceCoords(enrichment.places, nominatimUA, { maxToGeocode: 120 });
      if (geo.failed > 0) {
        geocodeWarnings.push(
          `Couldn't geocode ${geo.failed} of ${geo.attempted} coord-less addresses; those records will sync without primary_location.`,
        );
      }
    } else {
      geocodeWarnings.push("NOMINATIM_USER_AGENT not set — coord-less places will sync without primary_location.");
    }
    const attio = await pushPlacesToAttio(gate.apiKey, enrichment.places, { caller });
    return NextResponse.json({
      ...attio,
      enrichedCount: enrichment.places.filter((p) => p.industry).length,
      errors: [...geocodeWarnings, ...enrichment.errors, ...attio.errors],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
