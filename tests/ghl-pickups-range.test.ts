import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, hasUnlockCookieMock, searchContactsByTagMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    hasUnlockCookieMock: vi.fn(),
    searchContactsByTagMock: vi.fn(),
  }),
);

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/attio-unlock", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/attio-unlock")>(
      "@/lib/attio-unlock",
    );
  return {
    ...actual,
    hasUnlockCookie: hasUnlockCookieMock,
    getAttioApiKey: vi.fn(() => "test-attio"),
  };
});
// Mock the GHL client's network surface but keep the date helpers real —
// this exercises bookingDateKeyInTz and parseDateAsEpochMs end-to-end through
// the route handler.
vi.mock("@/lib/clients/ghlClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/clients/ghlClient")>(
      "@/lib/clients/ghlClient",
    );
  return {
    ...actual,
    searchContactsByTag: searchContactsByTagMock,
    getLocationId: () => "loc-123",
    getBookingDateFieldId: () => "field-1",
  };
});

import { GET } from "@/app/api/ghl/pickups/today/route";
import { resolveRange } from "@/lib/pickup-date-range";

beforeEach(() => {
  authMock.mockReset();
  hasUnlockCookieMock.mockReset();
  searchContactsByTagMock.mockReset();
  authMock.mockResolvedValue({ user: { email: "ops@micro-agi.com" } });
  hasUnlockCookieMock.mockResolvedValue(true);
});

function buildRequest(qs: Record<string, string>): Request {
  const url = new URL("http://localhost/api/ghl/pickups/today");
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

function contact(id: string, bookingDate: string) {
  return {
    id,
    name: id,
    customFields: [{ id: "field-1", value: bookingDate }],
  };
}

describe("resolveRange — validation matrix", () => {
  it("defaults to today/today when both omitted", () => {
    const r = resolveRange(null, null, "UTC");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.range.from).toBe(r.range.to);
  });

  it("treats a lone `from` as a single-day query", () => {
    const r = resolveRange("2026-04-26", null, "UTC");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.range).toEqual({ from: "2026-04-26", to: "2026-04-26" });
  });

  it("400s when `to` is set without `from`", () => {
    const r = resolveRange(null, "2026-04-26", "UTC");
    expect(r.ok).toBe(false);
  });

  it("400s when `from` > `to`", () => {
    const r = resolveRange("2026-04-30", "2026-04-26", "UTC");
    expect(r.ok).toBe(false);
  });

  it("400s on malformed dates", () => {
    expect(resolveRange("garbage", "2026-04-26", "UTC").ok).toBe(false);
    expect(resolveRange("2026-13-01", "2026-04-26", "UTC").ok).toBe(false);
    expect(resolveRange("2026-02-30", "2026-04-26", "UTC").ok).toBe(false);
    expect(resolveRange("2026-04-26", "garbage", "UTC").ok).toBe(false);
  });

  it("accepts a 1-day range", () => {
    const r = resolveRange("2026-04-26", "2026-04-26", "UTC");
    expect(r.ok).toBe(true);
  });

  it("accepts up to 60 days inclusive", () => {
    // 60 days inclusive = +59 from start
    const r = resolveRange("2026-04-01", "2026-05-30", "UTC");
    expect(r.ok).toBe(true);
  });

  it("400s on a range exceeding 60 days", () => {
    const r = resolveRange("2026-01-01", "2026-12-31", "UTC");
    expect(r.ok).toBe(false);
  });
});

describe("GET /api/ghl/pickups/today — date-range filtering", () => {
  it("backward-compat: no from/to → today only (uses tz)", async () => {
    // Use a contrived contact set spanning multiple days, then assert
    // only today's NY date passes through.
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const yesterday = "2020-01-01";
    const tomorrow = "2099-12-31";
    searchContactsByTagMock.mockResolvedValue([
      contact("y", yesterday),
      contact("t", today),
      contact("m", tomorrow),
    ]);

    const res = await GET(buildRequest({ tz: "America/New_York" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: { id: string }[] };
    expect(body.contacts.map((c) => c.id)).toEqual(["t"]);
  });

  it("?from=2026-04-26&to=2026-04-26 → only that day", async () => {
    searchContactsByTagMock.mockResolvedValue([
      contact("a", "2026-04-25"),
      contact("b", "2026-04-26"),
      contact("c", "2026-04-27"),
    ]);
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: { id: string }[] };
    expect(body.contacts.map((c) => c.id)).toEqual(["b"]);
  });

  it("?from=2026-04-26&to=2026-04-27 → both days, sorted by time", async () => {
    searchContactsByTagMock.mockResolvedValue([
      contact("a", "2026-04-25"),
      contact("b", "2026-04-26"),
      contact("c", "2026-04-27"),
      contact("d", "2026-04-28"),
    ]);
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-27",
        tz: "America/New_York",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: { id: string }[] };
    expect(body.contacts.map((c) => c.id).sort()).toEqual(["b", "c"]);
  });

  it("?from=2026-04-30&to=2026-04-26 → 400", async () => {
    const res = await GET(
      buildRequest({ from: "2026-04-30", to: "2026-04-26" }),
    );
    expect(res.status).toBe(400);
  });

  it("?from=garbage&to=2026-04-26 → 400", async () => {
    const res = await GET(
      buildRequest({ from: "garbage", to: "2026-04-26" }),
    );
    expect(res.status).toBe(400);
  });

  it("?from=2026-01-01&to=2026-12-31 → 400 (range too wide)", async () => {
    const res = await GET(
      buildRequest({ from: "2026-01-01", to: "2026-12-31" }),
    );
    expect(res.status).toBe(400);
  });

  it("?to=… without from → 400", async () => {
    const res = await GET(buildRequest({ to: "2026-04-26" }));
    expect(res.status).toBe(400);
  });
});
