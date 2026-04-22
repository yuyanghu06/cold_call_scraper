import type { GeocodedLocation } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Warm-instance cache. Keyed on trimmed/lowercased location string.
const cache = new Map<string, GeocodedLocation>();

export class GeocodeNoMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodeNoMatchError";
  }
}

interface NominatimResult {
  lat?: string;
  lon?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocodeLocation(
  location: string,
  userAgent: string,
): Promise<GeocodedLocation> {
  const trimmed = location.trim();
  const key = trimmed.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  // A bare 5-digit number is almost always a US ZIP for this tool. Without country
  // context Nominatim may resolve it to another country's postal system or match it
  // as a house number abroad (e.g. "10003" → Marseille, FR). Route those through
  // Nominatim's structured query pinned to the US.
  const isUsZip = /^\d{5}$/.test(trimmed);
  const url = isUsZip
    ? `${NOMINATIM_URL}?postalcode=${encodeURIComponent(trimmed)}&country=us&format=json&limit=1&addressdetails=0`
    : `${NOMINATIM_URL}?q=${encodeURIComponent(trimmed)}&format=json&limit=1&addressdetails=0`;

  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent },
      });

      if (res.status >= 500) {
        lastError = new Error(`Nominatim ${res.status}`);
        if (attempt === 0) {
          await sleep(1000);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Nominatim returned ${res.status}: ${text}`);
      }

      const json = (await res.json()) as NominatimResult[];
      if (!Array.isArray(json) || json.length === 0) {
        throw new GeocodeNoMatchError(
          `Couldn't find a location matching '${location}'. Try a city, neighborhood, or zip code.`,
        );
      }
      const first = json[0];
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

  throw lastError instanceof Error
    ? lastError
    : new Error("Nominatim geocoding failed");
}
