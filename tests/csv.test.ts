import { describe, it, expect } from "vitest";
import { placesToCsv } from "@/lib/utils/csv";
import type { Place } from "@/lib/types";

function makePlace(overrides: Partial<Place>): Place {
  return {
    placeId: "p1",
    name: "Shop",
    phone: "555-123-4567",
    formattedPhone: "+15551234567",
    address: "123 Main St",
    city: "Brooklyn",
    state: "NY",
    zip: "11201",
    country: "US",
    website: "https://example.com",
    rating: 4.5,
    reviewCount: 42,
    categories: ["auto_repair", "car_repair"],
    googleMapsUrl: "https://maps.google.com/?cid=1",
    latitude: 40.7,
    longitude: -73.9,
    ...overrides,
  };
}

describe("placesToCsv", () => {
  it("includes the header row in the expected order", () => {
    const csv = placesToCsv([]);
    const firstLine = csv.split(/\r?\n/)[0];
    expect(firstLine).toBe(
      "shop_name,phone,phone_verified,phone_line_type,address,city,state,zip,website,google_rating,google_review_count,categories,google_maps_url,latitude,longitude,place_id,notes",
    );
  });

  it("renders categories pipe-delimited", () => {
    const csv = placesToCsv([makePlace({})]);
    expect(csv).toContain("auto_repair|car_repair");
  });

  it("quotes fields with commas, quotes, or newlines", () => {
    const place = makePlace({
      name: 'Joe, "The" Mechanic',
      address: "100 Main St\nSuite 2",
    });
    const csv = placesToCsv([place]);
    expect(csv).toContain('"Joe, ""The"" Mechanic"');
    expect(csv).toContain('"100 Main St\nSuite 2"');
  });

  it("renders phone_verified as true/false when set, empty when undefined", () => {
    const verified = placesToCsv([makePlace({ phoneVerified: true })]);
    const unverified = placesToCsv([makePlace({ phoneVerified: false })]);
    const unknown = placesToCsv([makePlace({ phoneVerified: undefined })]);
    expect(verified).toContain(",true,");
    expect(unverified).toContain(",false,");
    // Column 3 (phone_verified) should be empty between two commas.
    const unknownRow = unknown.split(/\r?\n/)[1];
    const cells = unknownRow.split(",");
    expect(cells[2]).toBe("");
  });
});
