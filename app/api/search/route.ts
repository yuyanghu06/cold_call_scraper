import { NextResponse } from "next/server";
import type { SearchRequest, SearchResponse } from "@/lib/types";
import {
  DEFAULT_MAX_REVIEW_COUNT,
  DEFAULT_MIN_REVIEW_COUNT,
  MAX_KEYWORDS_PER_REQUEST,
  MAX_PLACES_HARD_CAP,
  MAX_TWILIO_PHONES_PER_REQUEST,
} from "@/lib/constants";
import { searchPlacesParallel } from "@/lib/google-places";
import { dedupPlaces } from "@/lib/dedup";
import { filterPlaces } from "@/lib/filter";
import { enrichPlacesWithTwilio } from "@/lib/twilio-lookup";
import { placesToCsv } from "@/lib/csv";

// Requires Vercel Pro. On Hobby, reduce or remove.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function validateRequest(body: unknown): SearchRequest | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.keywords) || b.keywords.length === 0) {
    return { error: "keywords must be a non-empty array" };
  }
  if (b.keywords.length > MAX_KEYWORDS_PER_REQUEST) {
    return {
      error: `Too many keywords. Max is ${MAX_KEYWORDS_PER_REQUEST}.`,
    };
  }
  if (typeof b.location !== "string" || !b.location.trim()) {
    return { error: "location is required" };
  }
  if (!Array.isArray(b.excludeChains)) {
    return { error: "excludeChains must be an array" };
  }
  if (typeof b.runTwilioLookup !== "boolean") {
    return { error: "runTwilioLookup must be a boolean" };
  }
  if (b.maxPlaces !== undefined) {
    if (
      typeof b.maxPlaces !== "number" ||
      !Number.isFinite(b.maxPlaces) ||
      b.maxPlaces < 1
    ) {
      return { error: "maxPlaces must be a positive number" };
    }
    if (b.maxPlaces > MAX_PLACES_HARD_CAP) {
      return {
        error: `maxPlaces cannot exceed ${MAX_PLACES_HARD_CAP}.`,
      };
    }
  }

  const keywords = (b.keywords as unknown[])
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean);
  if (keywords.length === 0) {
    return { error: "keywords must contain at least one non-empty string" };
  }

  const excludeChains = (b.excludeChains as unknown[])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean);

  return {
    keywords,
    location: b.location.trim(),
    excludeChains,
    runTwilioLookup: b.runTwilioLookup,
    radiusMeters:
      typeof b.radiusMeters === "number" ? b.radiusMeters : undefined,
    maxReviewCount:
      typeof b.maxReviewCount === "number" ? b.maxReviewCount : undefined,
    minReviewCount:
      typeof b.minReviewCount === "number" ? b.minReviewCount : undefined,
    maxPlaces:
      typeof b.maxPlaces === "number" ? Math.floor(b.maxPlaces) : undefined,
  };
}

export async function POST(req: Request) {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleKey) {
    return NextResponse.json(
      { error: "Server missing GOOGLE_PLACES_API_KEY env var" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validateRequest(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const request = validated;
  const maxReviewCount = request.maxReviewCount ?? DEFAULT_MAX_REVIEW_COUNT;
  const minReviewCount = request.minReviewCount ?? DEFAULT_MIN_REVIEW_COUNT;

  const warnings: string[] = [];

  // Step 1 — parallel Places search
  const { results: keywordGroups, errors: placesErrors } =
    await searchPlacesParallel(googleKey, request.keywords, request.location);
  warnings.push(...placesErrors);
  const totalFound = keywordGroups.reduce((sum, g) => sum + g.length, 0);

  // Step 2 — dedup
  const deduped = dedupPlaces(keywordGroups);

  // Step 2b — cap total places (keeps filter/Twilio cost predictable)
  let capped = deduped;
  if (
    typeof request.maxPlaces === "number" &&
    deduped.length > request.maxPlaces
  ) {
    capped = deduped.slice(0, request.maxPlaces);
    warnings.push(
      `Capped to ${request.maxPlaces} places (scraped ${deduped.length} unique).`,
    );
  }

  // Step 3 — filter
  const { kept, excluded } = filterPlaces(capped, {
    excludeChains: request.excludeChains,
    maxReviewCount,
    minReviewCount,
  });

  // Step 4 — optional Twilio
  let finalPlaces = kept;
  let phoneValidated = 0;
  if (request.runTwilioLookup) {
    if (kept.length > MAX_TWILIO_PHONES_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `Too many phones for Twilio validation (${kept.length}). Max is ${MAX_TWILIO_PHONES_PER_REQUEST}. Disable Twilio lookup or narrow the search.`,
        },
        { status: 400 },
      );
    }
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      warnings.push(
        "Twilio credentials missing on server; skipping phone validation.",
      );
    } else {
      const enriched = await enrichPlacesWithTwilio(sid, token, kept);
      finalPlaces = enriched.places;
      warnings.push(...enriched.warnings);
      phoneValidated = finalPlaces.filter((p) => p.phoneVerified === true).length;
    }
  }

  // Step 5 — CSV
  const csvData = placesToCsv(finalPlaces);

  const response: SearchResponse = {
    totalFound,
    afterDedup: deduped.length,
    afterFilter: kept.length,
    phoneValidated,
    results: finalPlaces,
    excluded,
    csvData,
    warnings,
  };

  return NextResponse.json(response);
}
