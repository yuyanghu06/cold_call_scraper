import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

const { authMock, hasUnlockCookieMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  hasUnlockCookieMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/attio-unlock", () => ({
  auth: authMock,
  getAttioApiKey: vi.fn(() => "test-attio-key"),
  hasUnlockCookie: hasUnlockCookieMock,
}));

import {
  authedUserFromRequest,
  extractBearerToken,
  signMobileSessionJWT,
  verifyMobileSessionJWT,
  REFRESH_THRESHOLD_SECONDS,
} from "@/lib/mobileAuth";

const SECRET = "0123456789abcdef0123456789abcdef0123456789ab";

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
  authMock.mockReset();
  hasUnlockCookieMock.mockReset();
});

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/anything", { headers });
}

describe("extractBearerToken", () => {
  it("reads `Authorization: Bearer <token>`", () => {
    expect(extractBearerToken(reqWith({ authorization: "Bearer abc.def.ghi" }))).toBe(
      "abc.def.ghi",
    );
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken(reqWith({ authorization: "bearer abc" }))).toBe("abc");
  });

  it("returns null when missing", () => {
    expect(extractBearerToken(reqWith({}))).toBeNull();
  });

  it("returns null on malformed values", () => {
    expect(extractBearerToken(reqWith({ authorization: "Token abc" }))).toBeNull();
    expect(extractBearerToken(reqWith({ authorization: "Bearer " }))).toBeNull();
  });
});

describe("signMobileSessionJWT / verifyMobileSessionJWT", () => {
  it("round-trips claims", async () => {
    const token = await signMobileSessionJWT({
      sub: "alice@micro-agi.com",
      name: "Alice",
      picture: "https://x/y.jpg",
      unlocked: true,
    });
    const claims = await verifyMobileSessionJWT(token);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("alice@micro-agi.com");
    expect(claims?.name).toBe("Alice");
    expect(claims?.picture).toBe("https://x/y.jpg");
    expect(claims?.unlocked).toBe(true);
    expect(typeof claims?.exp).toBe("number");
  });

  it("preserves unlocked=false explicitly", async () => {
    const token = await signMobileSessionJWT({
      sub: "bob@gmail.com",
      unlocked: false,
    });
    const claims = await verifyMobileSessionJWT(token);
    expect(claims?.unlocked).toBe(false);
    expect(claims?.name).toBeUndefined();
  });

  it("rejects expired tokens", async () => {
    const expired = await new SignJWT({ unlocked: true })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("x@y.com")
      .setIssuer("microagi.cold-call-scraper")
      .setAudience("fieldagiusa.mobile")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 40)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyMobileSessionJWT(expired)).toBeNull();
  });

  it("rejects tokens signed with a different secret", async () => {
    const wrong = await new SignJWT({ unlocked: true })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("x@y.com")
      .setIssuer("microagi.cold-call-scraper")
      .setAudience("fieldagiusa.mobile")
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("a-different-secret-of-decent-length-aaa"));
    expect(await verifyMobileSessionJWT(wrong)).toBeNull();
  });

  it("rejects tokens with the wrong audience", async () => {
    const wrongAud = await new SignJWT({ unlocked: true })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("x@y.com")
      .setIssuer("microagi.cold-call-scraper")
      .setAudience("some-other-app")
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyMobileSessionJWT(wrongAud)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyMobileSessionJWT("not.a.jwt")).toBeNull();
    expect(await verifyMobileSessionJWT("")).toBeNull();
  });

  it("REFRESH_THRESHOLD_SECONDS is 7 days", () => {
    expect(REFRESH_THRESHOLD_SECONDS).toBe(60 * 60 * 24 * 7);
  });
});

describe("authedUserFromRequest", () => {
  it("uses Bearer when present and valid", async () => {
    const token = await signMobileSessionJWT({
      sub: "ios@micro-agi.com",
      name: "iOS",
      unlocked: true,
    });
    const user = await authedUserFromRequest(
      reqWith({ authorization: `Bearer ${token}` }),
    );
    expect(user).not.toBeNull();
    expect(user?.email).toBe("ios@micro-agi.com");
    expect(user?.unlocked).toBe(true);
    expect(user?.source).toBe("mobile");
    expect(user?.name).toBe("iOS");
    expect(authMock).not.toHaveBeenCalled();
    expect(hasUnlockCookieMock).not.toHaveBeenCalled();
  });

  it("rejects when Bearer is malformed (does NOT fall through to cookie)", async () => {
    authMock.mockResolvedValue({ user: { email: "a@b.com" } });
    hasUnlockCookieMock.mockResolvedValue(true);
    const user = await authedUserFromRequest(
      reqWith({ authorization: "Bearer not.a.jwt" }),
    );
    expect(user).toBeNull();
    expect(authMock).not.toHaveBeenCalled();
  });

  it("falls back to NextAuth cookie session when no Bearer is present", async () => {
    authMock.mockResolvedValue({
      user: { email: "web@micro-agi.com", name: "Web", image: "https://x/x.jpg" },
    });
    hasUnlockCookieMock.mockResolvedValue(true);
    const user = await authedUserFromRequest(reqWith({}));
    expect(user).not.toBeNull();
    expect(user?.email).toBe("web@micro-agi.com");
    expect(user?.unlocked).toBe(true);
    expect(user?.source).toBe("cookie");
    expect(user?.name).toBe("Web");
    expect(user?.picture).toBe("https://x/x.jpg");
  });

  it("returns null when neither Bearer nor session is present", async () => {
    authMock.mockResolvedValue(null);
    hasUnlockCookieMock.mockResolvedValue(false);
    expect(await authedUserFromRequest(reqWith({}))).toBeNull();
  });

  it("treats cookie users as locked when unlock cookie is missing", async () => {
    authMock.mockResolvedValue({ user: { email: "a@b.com" } });
    hasUnlockCookieMock.mockResolvedValue(false);
    const user = await authedUserFromRequest(reqWith({}));
    expect(user?.unlocked).toBe(false);
  });
});
