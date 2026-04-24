const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export const FIELD_MASK = [
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

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GooglePlaceRaw {
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

export interface SearchTextResponse {
  places?: GooglePlaceRaw[];
  nextPageToken?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchTextOnce(
  apiKey: string,
  body: Record<string, unknown>,
  fieldMask: string = FIELD_MASK,
): Promise<SearchTextResponse> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return (await res.json()) as SearchTextResponse;

    if (res.status === 429) {
      await sleep(1000 * Math.pow(2, attempt));
      lastError = new Error(`Google Places 429 (attempt ${attempt + 1})`);
      continue;
    }

    const text = await res.text();
    if (res.status === 403) {
      const lower = text.toLowerCase();
      if (lower.includes("service_disabled") || lower.includes("has not been used in project")) {
        throw new Error(
          "Places API (New) is not enabled on this Google Cloud project. Enable it and wait ~1 minute before retrying.",
        );
      }
      if (lower.includes("quota")) {
        throw new Error("Google Places daily quota hit. Try again tomorrow or contact admin.");
      }
      if (lower.includes("api_key") || lower.includes("api key")) {
        throw new Error("Google Places rejected the API key — check restrictions or project.");
      }
    }
    throw new Error(`Google Places error ${res.status}: ${text}`);
  }

  throw lastError instanceof Error ? lastError : new Error("Google Places failed after retries");
}
