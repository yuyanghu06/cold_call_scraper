import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authMock,
  hasUnlockCookieMock,
  searchContactsByTagMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  hasUnlockCookieMock: vi.fn(),
  searchContactsByTagMock: vi.fn(),
}));

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

interface ContactStub {
  id: string;
  name?: string;
  tags?: string[];
  source?: string;
  customFields?: Array<{ id?: string; name?: string; value?: unknown }>;
  customField?: Array<{ id?: string; fieldKey?: string; value?: unknown }>;
}

function contact(
  id: string,
  bookingDate: string,
  extra: Partial<{
    tags: string[];
    source: string;
    customFields: Array<{ id?: string; name?: string; value?: unknown }>;
    customField: Array<{ id?: string; fieldKey?: string; value?: unknown }>;
  }> = {},
): ContactStub {
  const customFields = [
    { id: "field-1", value: bookingDate },
    ...(extra.customFields ?? []),
  ];
  return {
    id,
    name: id,
    tags: extra.tags,
    customFields,
    ...(extra.customField ? { customField: extra.customField } : {}),
    ...(extra.source !== undefined ? { source: extra.source } : {}),
  };
}

// Returns a mock implementation that maps each tag → a slice of `byTag`.
// Lets us verify the route searches across all three states and unions
// the results without picking up duplicates.
function mockSearchByTag(byTag: Partial<Record<string, ContactStub[]>>) {
  searchContactsByTagMock.mockImplementation(async (tag: string) => byTag[tag] ?? []);
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
    expect(resolveRange(null, "2026-04-26", "UTC").ok).toBe(false);
  });

  it("400s when `from` > `to`", () => {
    expect(resolveRange("2026-04-30", "2026-04-26", "UTC").ok).toBe(false);
  });

  it("400s on malformed dates", () => {
    expect(resolveRange("garbage", "2026-04-26", "UTC").ok).toBe(false);
    expect(resolveRange("2026-13-01", "2026-04-26", "UTC").ok).toBe(false);
    expect(resolveRange("2026-02-30", "2026-04-26", "UTC").ok).toBe(false);
  });

  it("400s on a range exceeding 60 days", () => {
    expect(resolveRange("2026-01-01", "2026-12-31", "UTC").ok).toBe(false);
  });
});

describe("GET /api/ghl/pickups/today — tag-union driver", () => {
  it("queries all three pickup states (calendly-bookings, picked_up, no_pickup)", async () => {
    mockSearchByTag({});
    await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const calledWith = searchContactsByTagMock.mock.calls.map((c) => c[0]);
    expect(calledWith).toEqual([
      "calendly-bookings",
      "picked_up",
      "no_pickup",
    ]);
  });

  it("returns a contact tagged picked_up if their booking-date is in range", async () => {
    mockSearchByTag({
      picked_up: [contact("c-picked", "2026-04-26", { tags: ["picked_up"] })],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contacts: Array<{ id: string; tags: string[] }>;
    };
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c-picked");
    expect(body.contacts[0].tags).toEqual(["picked_up"]);
  });

  it("returns a contact tagged no_pickup if their booking-date is in range", async () => {
    mockSearchByTag({
      no_pickup: [contact("c-noshow", "2026-04-26", { tags: ["no_pickup"] })],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      contacts: Array<{ id: string; tags: string[] }>;
    };
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].tags).toEqual(["no_pickup"]);
  });

  it("returns the union of pending + picked + no-pickup contacts on the same day", async () => {
    mockSearchByTag({
      "calendly-bookings": [
        contact("c-pending", "2026-04-26", { tags: ["calendly-bookings"] }),
      ],
      picked_up: [contact("c-picked", "2026-04-26", { tags: ["picked_up"] })],
      no_pickup: [contact("c-noshow", "2026-04-26", { tags: ["no_pickup"] })],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ id: string; tags: string[] }>;
    };
    expect(body.contacts.map((c) => c.id).sort()).toEqual([
      "c-noshow",
      "c-pending",
      "c-picked",
    ]);
  });

  it("dedupes a contact that appears under multiple tag searches", async () => {
    const dup = contact("c-dup", "2026-04-26", {
      tags: ["calendly-bookings", "picked_up"],
    });
    mockSearchByTag({
      "calendly-bookings": [dup],
      picked_up: [dup],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ id: string }> };
    expect(body.contacts).toHaveLength(1);
  });

  it("filters out contacts whose booking-date is outside the window", async () => {
    mockSearchByTag({
      "calendly-bookings": [
        contact("a", "2026-04-25"),
        contact("b", "2026-04-26"),
        contact("c", "2026-04-27"),
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ id: string }> };
    expect(body.contacts.map((c) => c.id)).toEqual(["b"]);
  });

  it("multi-day ranges include each contact in the window", async () => {
    mockSearchByTag({
      "calendly-bookings": [
        contact("a", "2026-04-25"),
        contact("b", "2026-04-26"),
        contact("c", "2026-04-27"),
        contact("d", "2026-04-28"),
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-27",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ id: string }> };
    expect(body.contacts.map((c) => c.id).sort()).toEqual(["b", "c"]);
  });

  it("?from=2026-04-30&to=2026-04-26 → 400", async () => {
    const res = await GET(
      buildRequest({ from: "2026-04-30", to: "2026-04-26" }),
    );
    expect(res.status).toBe(400);
    expect(searchContactsByTagMock).not.toHaveBeenCalled();
  });

  it("emits a warning when one of the tag searches fails but still returns the others", async () => {
    searchContactsByTagMock.mockImplementation(async (tag: string) => {
      if (tag === "no_pickup") throw new Error("rate limited");
      if (tag === "calendly-bookings") {
        return [contact("c", "2026-04-26", { tags: ["calendly-bookings"] })];
      }
      return [];
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ id: string }>;
      warnings: string[];
    };
    expect(body.contacts.map((c) => c.id)).toEqual(["c"]);
    expect(body.warnings.join(" ")).toContain('"no_pickup"');
  });
});

describe("GET /api/ghl/pickups/today — discoverySource", () => {
  it("uses the v2 customFields shape over top-level source", async () => {
    mockSearchByTag({
      "calendly-bookings": [
        contact("c", "2026-04-26", {
          source: "calendly",
          customFields: [
            { id: "f-other", name: "Other", value: "ignored" },
            { id: "f-disc", name: "discovery_source", value: "Google Ads" },
          ],
        }),
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ discoverySource: string | null }>;
    };
    expect(body.contacts[0].discoverySource).toBe("Google Ads");
  });

  it("uses the v1 customField fieldKey shape (case-insensitive)", async () => {
    mockSearchByTag({
      "calendly-bookings": [
        contact("c", "2026-04-26", {
          customField: [
            { id: "f-disc", fieldKey: "Discovery_Source", value: "Instagram" },
          ],
        }),
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ discoverySource: string | null }>;
    };
    expect(body.contacts[0].discoverySource).toBe("Instagram");
  });

  it("falls back to top-level source when no custom field matches", async () => {
    mockSearchByTag({
      "calendly-bookings": [
        contact("c", "2026-04-26", { source: "  Facebook Ads  " }),
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ discoverySource: string | null }>;
    };
    expect(body.contacts[0].discoverySource).toBe("Facebook Ads");
  });

  it("returns null when neither custom field nor source is set", async () => {
    mockSearchByTag({
      "calendly-bookings": [contact("c", "2026-04-26")],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ discoverySource: string | null }>;
    };
    expect(body.contacts[0].discoverySource).toBeNull();
  });
});
