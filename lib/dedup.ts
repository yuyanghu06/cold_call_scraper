import type { Place } from "./types";

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function reviewScore(p: Place): number {
  return p.reviewCount ?? 0;
}

export function dedupPlaces(groups: Place[][]): Place[] {
  const byPlaceId = new Map<string, Place>();
  for (const group of groups) {
    for (const place of group) {
      const existing = byPlaceId.get(place.placeId);
      if (!existing) {
        byPlaceId.set(place.placeId, place);
      } else if (reviewScore(place) > reviewScore(existing)) {
        // Keep the entry with more review data.
        byPlaceId.set(place.placeId, place);
      }
    }
  }

  const byPhone = new Map<string, Place>();
  const output: Place[] = [];

  for (const place of byPlaceId.values()) {
    const phoneKey = normalizePhone(place.phone);
    if (!phoneKey) {
      output.push(place);
      continue;
    }
    const existing = byPhone.get(phoneKey);
    if (!existing) {
      byPhone.set(phoneKey, place);
      output.push(place);
    } else if (reviewScore(place) > reviewScore(existing)) {
      const idx = output.indexOf(existing);
      if (idx >= 0) output[idx] = place;
      byPhone.set(phoneKey, place);
    }
  }

  return output;
}
