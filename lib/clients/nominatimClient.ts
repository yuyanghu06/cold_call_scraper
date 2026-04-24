const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface NominatimResult {
  lat?: string;
  lon?: string;
}

export function buildNominatimUrl(location: string): string {
  const isUsZip = /^\d{5}$/.test(location.trim());
  return isUsZip
    ? `${NOMINATIM_URL}?postalcode=${encodeURIComponent(location.trim())}&country=us&format=json&limit=1&addressdetails=0`
    : `${NOMINATIM_URL}?q=${encodeURIComponent(location.trim())}&format=json&limit=1&addressdetails=0`;
}

export async function fetchGeocodeResults(
  url: string,
  userAgent: string,
): Promise<NominatimResult[]> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (res.status >= 500) throw new Error(`Nominatim ${res.status}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nominatim returned ${res.status}: ${text}`);
  }
  return (await res.json()) as NominatimResult[];
}
