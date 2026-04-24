import { describe, it, expect } from "vitest";
import { normalizeIndustry } from "@/lib/services/enrichmentService";

describe("normalizeIndustry", () => {
  it("accepts a single lowercase word", () => {
    expect(normalizeIndustry("automotive")).toBe("automotive");
    expect(normalizeIndustry("plumbing")).toBe("plumbing");
  });

  it("downcases, trims, and takes the first word of multi-word responses", () => {
    expect(normalizeIndustry("Automotive")).toBe("automotive");
    expect(normalizeIndustry("  HVAC  ")).toBe("hvac");
    expect(normalizeIndustry("auto repair shop")).toBe("auto");
  });

  it("strips punctuation and symbols within a token", () => {
    expect(normalizeIndustry("'wholesale'")).toBe("wholesale");
    expect(normalizeIndustry("retail.")).toBe("retail");
    // hyphens get stripped, not split on — compound labels concatenate
    expect(normalizeIndustry("auto-repair")).toBe("autorepair");
  });

  it("rejects generic fallback labels", () => {
    expect(normalizeIndustry("unknown")).toBeNull();
    expect(normalizeIndustry("other")).toBeNull();
    expect(normalizeIndustry("MISC")).toBeNull();
    expect(normalizeIndustry("general")).toBeNull();
    expect(normalizeIndustry("n/a")).toBeNull();
  });

  it("rejects too-short or too-long labels", () => {
    expect(normalizeIndustry("a")).toBeNull();
    expect(normalizeIndustry("a".repeat(31))).toBeNull();
  });

  it("returns null for empty or whitespace input", () => {
    expect(normalizeIndustry("")).toBeNull();
    expect(normalizeIndustry("   ")).toBeNull();
  });
});
