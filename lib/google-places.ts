import type { GeocodedLocation, Place } from "./types";
import {
  MAX_RESULTS_PER_KEYWORD,
  PLACES_MAX_RADIUS_METERS,
} from "./constants";

export interface PlacesSearchArea {
  center: GeocodedLocation;
  radiusMeters: number;
}

// Google Places (New) `searchText` only accepts `rectangle` under `locationRestriction`
// (circle is supported under `locationBias`, which is a soft hint, not a hard cap).
// We approximate our circular radius with a bounding box — slightly larger than the
// circle by a factor of 4/π ≈ 1.27, but it's a true hard cutoff by Google.
function circleToRectangle(center: GeocodedLocation, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  // Guard against cos(lat) ≈ 0 near the poles. Irrelevant for US ops but cheap insurance.
  const lngDelta = radiusMeters / (111_320 * Math.max(cosLat, 1e-6));
  return {
    low: {
      latitude: center.lat - latDelta,
      longitude: center.lng - lngDelta,
    },
    high: {
      latitude: center.lat + latDelta,
      longitude: center.lng + lngDelta,
    },
  };
}

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.googleMapsUri",
  "places.location",
  "nextPageToken",
].join(",");

interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface GooglePlaceRaw {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
}

interface SearchTextResponse {
  places?: GooglePlaceRaw[];
  nextPageToken?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findAddressComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
): string | null {
  if (!components) return null;
  const match = components.find((c) => c.types?.includes(type));
  return match?.shortText || match?.longText || null;
}

function mapRawToPlace(raw: GooglePlaceRaw): Place | null {
  if (!raw.id) return null;
  const phone = raw.nationalPhoneNumber ?? null;
  const formattedPhone = raw.internationalPhoneNumber ?? null;
  const address = raw.formattedAddress ?? "";
  const city =
    findAddressComponent(raw.addressComponents, "locality") ??
    findAddressComponent(raw.addressComponents, "sublocality") ??
    findAddressComponent(raw.addressComponents, "postal_town");
  const state = findAddressComponent(
    raw.addressComponents,
    "administrative_area_level_1",
  );
  const zip = findAddressComponent(raw.addressComponents, "postal_code");
  const country = findAddressComponent(raw.addressComponents, "country");

  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? "",
    phone,
    formattedPhone,
    address,
    city,
    state,
    zip,
    country,
    website: raw.websiteUri ?? null,
    rating: raw.rating ?? null,
    reviewCount: raw.userRatingCount ?? null,
    categories: raw.types ?? [],
    googleMapsUrl: raw.googleMapsUri ?? "",
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
  };
}

async function searchTextOnce(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<SearchTextResponse> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return (await res.json()) as SearchTextResponse;
    }

    if (res.status === 429) {
      const backoff = 1000 * Math.pow(2, attempt);
      await sleep(backoff);
      lastError = new Error(`Google Places 429 (attempt ${attempt + 1})`);
      continue;
    }

    const text = await res.text();
    if (res.status === 403) {
      const lower = text.toLowerCase();
      if (lower.includes("service_disabled") || lower.includes("has not been used in project")) {
        throw new Error(
          "Places API (New) is not enabled on the Google Cloud project for this API key. Enable it at https://console.cloud.google.com/apis/library/places.googleapis.com and wait ~1 minute before retrying.",
        );
      }
      if (lower.includes("quota")) {
        throw new Error(
          "Google Places daily quota hit. Try again tomorrow or contact admin.",
        );
      }
      if (lower.includes("api_key") || lower.includes("api key")) {
        throw new Error(
          "Google Places rejected the API key (check restrictions or that the key belongs to the right project).",
        );
      }
    }
    throw new Error(`Google Places error ${res.status}: ${text}`);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Google Places failed after retries");
}

export async function searchPlacesForKeyword(
  apiKey: string,
  keyword: string,
  area: PlacesSearchArea,
): Promise<Place[]> {
  const radius = Math.min(area.radiusMeters, PLACES_MAX_RADIUS_METERS);
  const rectangle = circleToRectangle(area.center, radius);
  const collected: Place[] = [];
  let pageToken: string | undefined;

  while (collected.length < MAX_RESULTS_PER_KEYWORD) {
    const body: Record<string, unknown> = {
      textQuery: keyword,
      pageSize: 20,
      maxResultCount: 20,
      locationRestriction: { rectangle },
    };
    if (pageToken) body.pageToken = pageToken;

    const response = await searchTextOnce(apiKey, body);
    const places = response.places ?? [];
    for (const raw of places) {
      const mapped = mapRawToPlace(raw);
      if (mapped) collected.push(mapped);
      if (collected.length >= MAX_RESULTS_PER_KEYWORD) break;
    }

    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
    // Google requires a short delay before the next_page_token is valid.
    await sleep(1500);
  }

  return collected;
}

export async function searchPlacesParallel(
  apiKey: string,
  keywords: string[],
  area: PlacesSearchArea,
): Promise<{ results: Place[][]; errors: string[] }> {
  const settled = await Promise.allSettled(
    keywords.map((k) => searchPlacesForKeyword(apiKey, k, area)),
  );

  const results: Place[][] = [];
  const errors: string[] = [];

  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      results.push([]);
      const msg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      errors.push(`Keyword "${keywords[i]}" failed: ${msg}`);
    }
  });

  return { results, errors };
}
