import { describe, it, expect } from "vitest";
import { normalizeTerritory, parseRetryAfter } from "@/lib/attio";

describe("parseRetryAfter", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfter("5", 1000)).toBe(5000);
    expect(parseRetryAfter("0", 1000)).toBe(0);
  });

  it("parses fractional seconds", () => {
    expect(parseRetryAfter("0.5", 1000)).toBe(500);
  });

  it("parses HTTP-date and returns ms until then", () => {
    const future = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfter(future, 1000);
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThanOrEqual(3000);
  });

  it("returns 0 for a past HTTP-date (don't sleep into the past)", () => {
    const past = new Date(Date.now() - 10000).toUTCString();
    expect(parseRetryAfter(past, 1000)).toBe(0);
  });

  it("falls back when header is null or garbage", () => {
    expect(parseRetryAfter(null, 1234)).toBe(1234);
    expect(parseRetryAfter("not a date", 1234)).toBe(1234);
  });
});

describe("normalizeTerritory", () => {
  it("expands two-letter US state codes to full names", () => {
    expect(normalizeTerritory("NY")).toBe("New York");
    expect(normalizeTerritory("CA")).toBe("California");
    expect(normalizeTerritory("DC")).toBe("District of Columbia");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeTerritory("ny")).toBe("New York");
    expect(normalizeTerritory(" tx ")).toBe("Texas");
  });

  it("passes full names through unchanged", () => {
    expect(normalizeTerritory("New York")).toBe("New York");
  });

  it("passes unknown values through (non-US tolerated, Attio will reject)", () => {
    expect(normalizeTerritory("Ontario")).toBe("Ontario");
  });
});
