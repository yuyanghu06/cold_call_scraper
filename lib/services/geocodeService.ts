import { buildNominatimUrl, fetchGeocodeResults } from "@/lib/clients/nominatimClient";
import type { GeocodedLocation, Place } from "@/lib/types";

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

// Nominatim's ToS is "≤ 1 request/sec, no heavy use". 2000ms between
// iteration starts buys margin for geocodeLocation's internal retry (which
// can fire a second request 1s after a failure), so even worst-case we stay
// under 1 req/sec averaged over any 2-second window. Slower than strictly
// necessary, but the operator has explicitly traded latency for safety.
const NOMINATIM_PACE_MS = 2000;

function hasFiniteCoords(p: Place): boolean {
  return (
    typeof p.latitude === "number" &&
    Number.isFinite(p.latitude) &&
    typeof p.longitude === "number" &&
    Number.isFinite(p.longitude)
  );
}

// For places Google Places returned without lat/lng, geocode their address
// via Nominatim so Attio's `primary_location` can be populated. Mutates each
// place's latitude/longitude in place on success; leaves them null on
// failure. Paced at 1.1s/request to respect Nominatim's rate limit.
export async function fillMissingPlaceCoords(
  places: Place[],
  userAgent: string,
  opts: { maxToGeocode?: number } = {},
): Promise<{ attempted: number; geocoded: number; failed: number }> {
  const needing = places.filter(
    (p) => !hasFiniteCoords(p) && typeof p.address === "string" && p.address.trim(),
  );
  const max = Math.max(0, opts.maxToGeocode ?? needing.length);
  const queue = needing.slice(0, max);

  let geocoded = 0;
  let failed = 0;
  let lastCall = 0;

  for (const p of queue) {
    const wait = NOMINATIM_PACE_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const { lat, lng } = await geocodeLocation(p.address, userAgent);
      p.latitude = lat;
      p.longitude = lng;
      geocoded++;
    } catch {
      failed++;
    }
  }

  return { attempted: queue.length, geocoded, failed };
}
