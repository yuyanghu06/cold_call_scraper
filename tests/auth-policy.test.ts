import { describe, it, expect } from "vitest";
import {
  isAllowed,
  isAllowedDomain,
  isAllowedEmail,
} from "@/lib/auth-policy";

describe("isAllowedDomain", () => {
  const DOMAIN = "micro-agi.com";

  it("accepts a profile whose Google-signed hd matches", () => {
    expect(isAllowedDomain({ hd: "micro-agi.com" }, DOMAIN)).toBe(true);
  });

  it("rejects a profile with the wrong hd", () => {
    expect(isAllowedDomain({ hd: "example.com" }, DOMAIN)).toBe(false);
  });

  it("rejects a personal Gmail profile (no hd claim)", () => {
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
    expect(isAllowedDomain({ hd: 1 }, DOMAIN)).toBe(false);
    expect(isAllowedDomain({ hd: true }, DOMAIN)).toBe(false);
  });

  it("is exact-match, not suffix-match", () => {
    expect(isAllowedDomain({ hd: "evil.micro-agi.com" }, DOMAIN)).toBe(false);
    expect(isAllowedDomain({ hd: "micro-agi.com.evil.com" }, DOMAIN)).toBe(
      false,
    );
  });

  it("rejects when allowedDomain is empty string", () => {
    expect(isAllowedDomain({ hd: "anything.com" }, "")).toBe(false);
    expect(isAllowedDomain({ hd: "" }, "")).toBe(false);
  });
});

describe("isAllowedEmail", () => {
  const LIST = new Set(["invited@gmail.com", "partner@acme.co"]);

  it("accepts an exact email match", () => {
    expect(isAllowedEmail({ email: "invited@gmail.com" }, LIST)).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isAllowedEmail({ email: "Invited@Gmail.com" }, LIST)).toBe(true);
    expect(isAllowedEmail({ email: "PARTNER@ACME.CO" }, LIST)).toBe(true);
  });

  it("ignores surrounding whitespace on the incoming email", () => {
    expect(isAllowedEmail({ email: "  invited@gmail.com  " }, LIST)).toBe(true);
  });

  it("rejects emails not in the list", () => {
    expect(isAllowedEmail({ email: "stranger@gmail.com" }, LIST)).toBe(false);
  });

  it("rejects when email is missing or not a string", () => {
    expect(isAllowedEmail({}, LIST)).toBe(false);
    expect(isAllowedEmail({ email: "" }, LIST)).toBe(false);
    expect(isAllowedEmail({ email: 42 }, LIST)).toBe(false);
  });

  it("rejects when the allowlist is empty", () => {
    expect(isAllowedEmail({ email: "anyone@gmail.com" }, new Set())).toBe(
      false,
    );
  });

  it("rejects undefined and null profiles", () => {
    expect(isAllowedEmail(undefined, LIST)).toBe(false);
    expect(isAllowedEmail(null, LIST)).toBe(false);
  });
});

describe("isAllowed (combined domain + email policy)", () => {
  const policy = {
    allowedDomain: "micro-agi.com",
    allowedEmails: new Set(["invited@gmail.com"]),
  };

  it("allows a Workspace user via domain match", () => {
    expect(
      isAllowed(
        { hd: "micro-agi.com", email: "alice@micro-agi.com" },
        policy,
      ),
    ).toBe(true);
  });

  it("allows an outside collaborator via email allowlist", () => {
    // No `hd` (personal Gmail) but on the invite list.
    expect(isAllowed({ email: "invited@gmail.com" }, policy)).toBe(true);
  });

  it("rejects a random Gmail user", () => {
    expect(isAllowed({ email: "rando@gmail.com" }, policy)).toBe(false);
  });

  it("rejects a user from another Workspace org not on the invite list", () => {
    expect(
      isAllowed({ hd: "other-co.com", email: "x@other-co.com" }, policy),
    ).toBe(false);
  });

  it("rejects everything when both gates are empty", () => {
    const empty = { allowedDomain: "", allowedEmails: new Set<string>() };
    expect(
      isAllowed({ hd: "micro-agi.com", email: "a@micro-agi.com" }, empty),
    ).toBe(false);
    expect(isAllowed({ email: "invited@gmail.com" }, empty)).toBe(false);
  });
});
