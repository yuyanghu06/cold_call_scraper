import { describe, it, expect } from "vitest";
import { filterPlaces } from "@/lib/filter";
import type { Place } from "@/lib/types";

function makePlace(overrides: Partial<Place>): Place {
  return {
    placeId: "p1",
    name: "Local Auto Repair",
    phone: "555-123-4567",
    formattedPhone: null,
    address: "",
    city: null,
    state: null,
    zip: null,
    country: null,
    website: null,
    rating: null,
    reviewCount: 20,
    categories: [],
    googleMapsUrl: "",
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe("filterPlaces", () => {
  it("excludes chains by case-insensitive substring", () => {
    const p1 = makePlace({ name: "Joe's Auto" });
    const p2 = makePlace({ name: "Mavis Tire & Brake" });
    const { kept, excluded } = filterPlaces([p1, p2], {
      excludeChains: ["Mavis"],
      maxReviewCount: 1000,
      minReviewCount: 0,
    });
    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe("Joe's Auto");
    expect(excluded[0].excludedReason).toContain("chain:");
  });

  it("drops places over review ceiling", () => {
    const p = makePlace({ reviewCount: 5000 });
    const { kept, excluded } = filterPlaces([p], {
      excludeChains: [],
      maxReviewCount: 400,
      minReviewCount: 0,
    });
    expect(kept).toHaveLength(0);
    expect(excluded[0].excludedReason).toBe("too_many_reviews");
  });

  it("drops places under review floor", () => {
    const p = makePlace({ reviewCount: 1 });
    const { kept, excluded } = filterPlaces([p], {
      excludeChains: [],
      maxReviewCount: 1000,
      minReviewCount: 10,
    });
    expect(kept).toHaveLength(0);
    expect(excluded[0].excludedReason).toBe("too_few_reviews");
  });

  it("drops places without a phone", () => {
    const p = makePlace({ phone: null });
    const { kept, excluded } = filterPlaces([p], {
      excludeChains: [],
      maxReviewCount: 1000,
      minReviewCount: 0,
    });
    expect(kept).toHaveLength(0);
    expect(excluded[0].excludedReason).toBe("no_phone");
  });
});
