import { describe, it, expect } from "vitest";
import { dedupPlaces } from "@/lib/utils/dedup";
import type { Place } from "@/lib/types";

function makePlace(overrides: Partial<Place>): Place {
  return {
    placeId: "p1",
    name: "Shop",
    phone: null,
    formattedPhone: null,
    address: "",
    city: null,
    state: null,
    zip: null,
    country: null,
    website: null,
    rating: null,
    reviewCount: null,
    categories: [],
    googleMapsUrl: "",
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe("dedupPlaces", () => {
  it("dedupes by placeId across groups", () => {
    const a = makePlace({ placeId: "p1", name: "A" });
    const b = makePlace({ placeId: "p1", name: "A-dup" });
    const c = makePlace({ placeId: "p2", name: "C" });
    const result = dedupPlaces([[a], [b, c]]);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.placeId).sort()).toEqual(["p1", "p2"]);
  });

  it("prefers the entry with more reviews when placeIds collide", () => {
    const low = makePlace({ placeId: "p1", name: "Low", reviewCount: 2 });
    const high = makePlace({ placeId: "p1", name: "High", reviewCount: 99 });
    const result = dedupPlaces([[low], [high]]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("High");
  });

  it("dedupes by normalized phone when placeIds differ", () => {
    const a = makePlace({
      placeId: "p1",
      phone: "(555) 123-4567",
      reviewCount: 10,
    });
    const b = makePlace({
      placeId: "p2",
      phone: "555-123-4567",
      reviewCount: 50,
    });
    const result = dedupPlaces([[a], [b]]);
    expect(result).toHaveLength(1);
    expect(result[0].placeId).toBe("p2");
  });

  it("keeps entries without phone numbers", () => {
    const a = makePlace({ placeId: "p1" });
    const b = makePlace({ placeId: "p2" });
    const result = dedupPlaces([[a, b]]);
    expect(result).toHaveLength(2);
  });
});
