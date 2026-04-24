import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { SearchRequest, SearchResponse } from "@/lib/types";
import {
  DEFAULT_MAX_REVIEW_COUNT,
  DEFAULT_MIN_REVIEW_COUNT,
  MAX_KEYWORDS_PER_REQUEST,
  MAX_PLACES_HARD_CAP,
  MAX_RADIUS_METERS,
  MAX_TWILIO_PHONES_PER_REQUEST,
  MIN_RADIUS_METERS,
} from "@/lib/constants";
import { GeocodeNoMatchError, geocodeLocation } from "@/lib/services/geocodeService";
import { searchPlacesParallel } from "@/lib/services/searchService";
import { dedupPlaces } from "@/lib/utils/dedup";
import { filterPlaces } from "@/lib/utils/filter";
import { enrichPlacesWithTwilio } from "@/lib/services/phoneService";
import { placesToCsv } from "@/lib/utils/csv";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function validateRequest(body: unknown): SearchRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid request body" };
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.keywords) || b.keywords.length === 0)
    return { error: "keywords must be a non-empty array" };
  if (b.keywords.length > MAX_KEYWORDS_PER_REQUEST)
    return { error: `Too many keywords. Max is ${MAX_KEYWORDS_PER_REQUEST}.` };
  if (typeof b.location !== "string" || !b.location.trim())
    return { error: "location is required" };
  if (typeof b.radiusMeters !== "number" || !Number.isFinite(b.radiusMeters))
    return { error: "radiusMeters is required and must be a number" };
  if (b.radiusMeters < MIN_RADIUS_METERS || b.radiusMeters > MAX_RADIUS_METERS)
    return { error: `radiusMeters must be between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS}.` };
  if (!Array.isArray(b.excludeChains))
    return { error: "excludeChains must be an array" };
  if (typeof b.runTwilioLookup !== "boolean")
    return { error: "runTwilioLookup must be a boolean" };
  if (b.maxPlaces !== undefined) {
    if (typeof b.maxPlaces !== "number" || !Number.isFinite(b.maxPlaces) || b.maxPlaces < 1)
      return { error: "maxPlaces must be a positive number" };
    if (b.maxPlaces > MAX_PLACES_HARD_CAP)
      return { error: `maxPlaces cannot exceed ${MAX_PLACES_HARD_CAP}.` };
  }

  const keywords = (b.keywords as unknown[])
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean);
  if (keywords.length === 0) return { error: "keywords must contain at least one non-empty string" };

  return {
    keywords,
    location: b.location.trim(),
    excludeChains: (b.excludeChains as unknown[])
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter(Boolean),
    runTwilioLookup: b.runTwilioLookup,
    radiusMeters: b.radiusMeters,
    maxReviewCount: typeof b.maxReviewCount === "number" ? b.maxReviewCount : undefined,
    minReviewCount: typeof b.minReviewCount === "number" ? b.minReviewCount : undefined,
    maxPlaces: typeof b.maxPlaces === "number" ? Math.floor(b.maxPlaces) : undefined,
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleKey)
    return NextResponse.json({ error: "Server missing GOOGLE_PLACES_API_KEY" }, { status: 500 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validateRequest(body);
  if ("error" in validated) return NextResponse.json({ error: validated.error }, { status: 400 });

  const request = validated;
  const maxReviewCount = request.maxReviewCount ?? DEFAULT_MAX_REVIEW_COUNT;
  const minReviewCount = request.minReviewCount ?? DEFAULT_MIN_REVIEW_COUNT;
  const warnings: string[] = [];

  const nominatimUA = process.env.NOMINATIM_USER_AGENT;
  if (!nominatimUA)
    return NextResponse.json({ error: "Server missing NOMINATIM_USER_AGENT" }, { status: 500 });

  let center;
  try {
    center = await geocodeLocation(request.location, nominatimUA);
  } catch (err) {
    if (err instanceof GeocodeNoMatchError)
      return NextResponse.json({ error: err.message }, { status: 400 });
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Geocoding failed: ${msg}` }, { status: 502 });
  }

  const { results: keywordGroups, errors: placesErrors } = await searchPlacesParallel(
    googleKey,
    request.keywords,
    { center, radiusMeters: request.radiusMeters },
  );
  warnings.push(...placesErrors);
  const totalFound = keywordGroups.reduce((sum, g) => sum + g.length, 0);

  const deduped = dedupPlaces(keywordGroups);

  let capped = deduped;
  if (typeof request.maxPlaces === "number" && deduped.length > request.maxPlaces) {
    capped = deduped.slice(0, request.maxPlaces);
    warnings.push(`Capped to ${request.maxPlaces} places (scraped ${deduped.length} unique).`);
  }

  const { kept, excluded } = filterPlaces(capped, { excludeChains: request.excludeChains, maxReviewCount, minReviewCount });

  let finalPlaces = kept;
  let phoneValidated = 0;
  if (request.runTwilioLookup) {
    if (kept.length > MAX_TWILIO_PHONES_PER_REQUEST) {
      return NextResponse.json(
        { error: `Too many phones for Twilio (${kept.length}). Max is ${MAX_TWILIO_PHONES_PER_REQUEST}.` },
        { status: 400 },
      );
    }
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      warnings.push("Twilio credentials missing; skipping phone validation.");
    } else {
      const enriched = await enrichPlacesWithTwilio(sid, token, kept);
      finalPlaces = enriched.places;
      warnings.push(...enriched.warnings);
      phoneValidated = finalPlaces.filter((p) => p.phoneVerified === true).length;
    }
  }

  const response: SearchResponse = {
    totalFound,
    afterDedup: deduped.length,
    afterFilter: kept.length,
    phoneValidated,
    results: finalPlaces,
    excluded,
    csvData: placesToCsv(finalPlaces),
    warnings,
  };

  return NextResponse.json(response);
}
