import type { Place } from "./types";

export interface FilterOptions {
  excludeChains: string[];
  maxReviewCount: number;
  minReviewCount: number;
}

export interface FilterResult {
  kept: Place[];
  excluded: Place[];
}

export function filterPlaces(
  places: Place[],
  options: FilterOptions,
): FilterResult {
  const { excludeChains, maxReviewCount, minReviewCount } = options;
  const loweredChains = excludeChains
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const kept: Place[] = [];
  const excluded: Place[] = [];

  for (const place of places) {
    const nameLower = place.name.toLowerCase();
    const chainHit = loweredChains.find((c) => nameLower.includes(c));
    if (chainHit) {
      excluded.push({ ...place, excludedReason: `chain:${chainHit}` });
      continue;
    }

    const reviewCount = place.reviewCount ?? 0;
    if (reviewCount > maxReviewCount) {
      excluded.push({ ...place, excludedReason: "too_many_reviews" });
      continue;
    }
    if (reviewCount < minReviewCount) {
      excluded.push({ ...place, excludedReason: "too_few_reviews" });
      continue;
    }

    if (!place.phone) {
      excluded.push({ ...place, excludedReason: "no_phone" });
      continue;
    }

    kept.push(place);
  }

  return { kept, excluded };
}
