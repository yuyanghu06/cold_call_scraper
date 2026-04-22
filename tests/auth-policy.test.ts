import { describe, it, expect } from "vitest";
import { isAllowedDomain } from "@/lib/auth-policy";

describe("isAllowedDomain", () => {
  const DOMAIN = "micro-agi.com";

  it("accepts a profile whose Google-signed hd matches", () => {
    expect(isAllowedDomain({ hd: "micro-agi.com" }, DOMAIN)).toBe(true);
  });

  it("rejects a profile with the wrong hd", () => {
    expect(isAllowedDomain({ hd: "example.com" }, DOMAIN)).toBe(false);
  });

  it("rejects a personal Gmail profile (no hd claim)", () => {
    // Personal Gmail accounts never get an `hd` claim from Google.
    expect(isAllowedDomain({}, DOMAIN)).toBe(false);
  });

  it("rejects undefined and null profiles", () => {
    expect(isAllowedDomain(undefined, DOMAIN)).toBe(false);
    expect(isAllowedDomain(null, DOMAIN)).toBe(false);
  });

  it("rejects empty-string hd", () => {
    expect(isAllowedDomain({ hd: "" }, DOMAIN)).toBe(false);
  });

  it("rejects a profile with hd set to a non-string", () => {
    // Belt-and-suspenders: the upstream type is `unknown`, so make sure a
    // caller passing a number/boolean can't slip through.
    expect(isAllowedDomain({ hd: 1 }, DOMAIN)).toBe(false);
    expect(isAllowedDomain({ hd: true }, DOMAIN)).toBe(false);
  });

  it("is exact-match, not suffix-match", () => {
    // Attacker-controlled domain `evil.micro-agi.com` registered with Workspace
    // must not pass. The check is strict equality.
    expect(isAllowedDomain({ hd: "evil.micro-agi.com" }, DOMAIN)).toBe(false);
    expect(isAllowedDomain({ hd: "micro-agi.com.evil.com" }, DOMAIN)).toBe(
      false,
    );
  });

  it("does not fall back to email when hd is missing", () => {
    // A profile with the right email but no `hd` is suspicious — we reject.
    // (Google Workspace always populates `hd`; missing it means it's a
    // personal @gmail.com account or some other oddity.)
    expect(
      isAllowedDomain(
        { hd: undefined, email: "someone@micro-agi.com" } as {
          hd?: unknown;
        },
        DOMAIN,
      ),
    ).toBe(false);
  });

  it("rejects when allowedDomain is empty string", () => {
    // Guard against a misconfigured env — we never want an empty allowlist to
    // accidentally allow-all.
    expect(isAllowedDomain({ hd: "anything.com" }, "")).toBe(false);
    expect(isAllowedDomain({ hd: "" }, "")).toBe(false);
  });
});
