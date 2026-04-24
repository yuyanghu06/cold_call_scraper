import { buildNominatimUrl, fetchGeocodeResults } from "@/lib/clients/nominatimClient";
import type { GeocodedLocation } from "@/lib/types";

const cache = new Map<string, GeocodedLocation>();

export class GeocodeNoMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodeNoMatchError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocodeLocation(
  location: string,
  userAgent: string,
): Promise<GeocodedLocation> {
  const key = location.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const url = buildNominatimUrl(location);
  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const results = await fetchGeocodeResults(url, userAgent);

      if (!Array.isArray(results) || results.length === 0) {
        throw new GeocodeNoMatchError(
          `Couldn't find a location matching '${location}'. Try a city, neighborhood, or zip code.`,
        );
      }

      const first = results[0];
      if (!first.lat || !first.lon) {
        throw new GeocodeNoMatchError(
          `Couldn't find a location matching '${location}'. Try a city, neighborhood, or zip code.`,
        );
      }

      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error(`Nominatim returned invalid coordinates for '${location}'`);
      }

      const geocoded: GeocodedLocation = { lat, lng };
      cache.set(key, geocoded);
      return geocoded;
    } catch (err) {
      if (err instanceof GeocodeNoMatchError) throw err;
      lastError = err;
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Nominatim geocoding failed");
}
