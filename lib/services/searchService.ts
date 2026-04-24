import {
  searchTextOnce,
  FIELD_MASK,
  type GoogleAddressComponent,
  type GooglePlaceRaw,
} from "@/lib/clients/googlePlacesClient";
import { MAX_RESULTS_PER_KEYWORD, PLACES_MAX_RADIUS_METERS } from "@/lib/constants";
import type { GeocodedLocation, Place } from "@/lib/types";
import type { PlacesSearchArea } from "@/lib/viewmodels/searchViewModel";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function circleToRectangle(center: GeocodedLocation, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const lngDelta = radiusMeters / (111_320 * Math.max(cosLat, 1e-6));
  return {
    low: { latitude: center.lat - latDelta, longitude: center.lng - lngDelta },
    high: { latitude: center.lat + latDelta, longitude: center.lng + lngDelta },
  };
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
  return {
    placeId: raw.id,
    name: raw.displayName?.text ?? "",
    phone: raw.nationalPhoneNumber ?? null,
    formattedPhone: raw.internationalPhoneNumber ?? null,
    address: raw.formattedAddress ?? "",
    city:
      findAddressComponent(raw.addressComponents, "locality") ??
      findAddressComponent(raw.addressComponents, "sublocality") ??
      findAddressComponent(raw.addressComponents, "postal_town"),
    state: findAddressComponent(raw.addressComponents, "administrative_area_level_1"),
    zip: findAddressComponent(raw.addressComponents, "postal_code"),
    country: findAddressComponent(raw.addressComponents, "country"),
    website: raw.websiteUri ?? null,
    rating: raw.rating ?? null,
    reviewCount: raw.userRatingCount ?? null,
    categories: raw.types ?? [],
    googleMapsUrl: raw.googleMapsUri ?? "",
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
  };
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
    for (const raw of response.places ?? []) {
      const mapped = mapRawToPlace(raw);
      if (mapped) collected.push(mapped);
      if (collected.length >= MAX_RESULTS_PER_KEYWORD) break;
    }

    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
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
      const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      errors.push(`Keyword "${keywords[i]}" failed: ${msg}`);
    }
  });

  return { results, errors };
}

export async function findStateByBusinessName(
  apiKey: string,
  name: string,
  address?: string | null,
): Promise<string | null> {
  const query = address ? `${name} ${address}` : name;
  const body = { textQuery: query, pageSize: 1, maxResultCount: 1 };
  const response = await searchTextOnce(apiKey, body, "places.addressComponents");
  const first = response.places?.[0];
  if (!first) return null;
  return findAddressComponent(first.addressComponents, "administrative_area_level_1");
}
