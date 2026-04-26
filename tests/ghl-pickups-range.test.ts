import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  authMock,
  hasUnlockCookieMock,
  getCalendarEventsMock,
  getContactMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  hasUnlockCookieMock: vi.fn(),
  getCalendarEventsMock: vi.fn(),
  getContactMock: vi.fn(),
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
    getCalendarEvents: getCalendarEventsMock,
    getContact: getContactMock,
    getLocationId: () => "loc-123",
    getPickupCalendarIds: () => ["cal-1"],
  };
});

import { GET } from "@/app/api/ghl/pickups/today/route";
import { resolveRange } from "@/lib/pickup-date-range";

beforeEach(() => {
  authMock.mockReset();
  hasUnlockCookieMock.mockReset();
  getCalendarEventsMock.mockReset();
  getContactMock.mockReset();
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
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  customFields?: Array<{ id?: string; name?: string; value?: unknown }>;
  customField?: Array<{ id?: string; fieldKey?: string; value?: unknown }>;
}

function event(contactId: string, isoStartTime: string, extra: Partial<{ id: string; notes: string }> = {}) {
  return {
    id: extra.id ?? `evt-${contactId}`,
    contactId,
    startTime: isoStartTime,
    notes: extra.notes,
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

describe("GET /api/ghl/pickups/today — calendar-events driver", () => {
  it("returns a contact even when they're already tagged picked_up", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c-picked", "2026-04-26T14:00:00.000Z"),
    ]);
    const pickedContact: ContactStub = {
      id: "c-picked",
      firstName: "Alice",
      lastName: "Picked",
      phone: "+15551234567",
      tags: ["picked_up"],
    };
    getContactMock.mockResolvedValueOnce(pickedContact);

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

  it("returns a contact even when they're already tagged no_pickup", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c-noshow", "2026-04-26T15:00:00.000Z"),
    ]);
    const noShow: ContactStub = {
      id: "c-noshow",
      name: "Bob NoShow",
      tags: ["no_pickup"],
    };
    getContactMock.mockResolvedValueOnce(noShow);

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

  it("returns the union of all states (pending, picked, no-pickup) on the same day", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c-pending", "2026-04-26T09:00:00.000Z"),
      event("c-picked", "2026-04-26T11:00:00.000Z"),
      event("c-noshow", "2026-04-26T13:00:00.000Z"),
    ]);
    const contactsById: Record<string, ContactStub> = {
      "c-pending": { id: "c-pending", name: "Pending", tags: ["calendly-bookings"] },
      "c-picked": { id: "c-picked", name: "Picked", tags: ["picked_up"] },
      "c-noshow": { id: "c-noshow", name: "NoShow", tags: ["no_pickup"] },
    };
    getContactMock.mockImplementation(async (cid: string) => contactsById[cid] ?? null);

    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ id: string; tags: string[]; appointmentTime: string }>;
    };
    expect(body.contacts.map((c) => c.id).sort()).toEqual([
      "c-noshow",
      "c-pending",
      "c-picked",
    ]);
    // Sorted ascending by appointmentTime.
    expect(body.contacts.map((c) => c.appointmentTime)).toEqual([
      "2026-04-26T09:00:00.000Z",
      "2026-04-26T11:00:00.000Z",
      "2026-04-26T13:00:00.000Z",
    ]);
  });

  it("from/to bound the calendar-events query (single-day window in tz)", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([]);
    await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    expect(getCalendarEventsMock).toHaveBeenCalledTimes(1);
    const [calendarId, locationId, startMs, endMs] =
      getCalendarEventsMock.mock.calls[0];
    expect(calendarId).toBe("cal-1");
    expect(locationId).toBe("loc-123");
    // 2026-04-26 00:00 NY = 2026-04-26T04:00 UTC, end = next day 04:00 UTC.
    const expectedStart = Date.UTC(2026, 3, 26, 4);
    const expectedEnd = Date.UTC(2026, 3, 27, 4);
    expect(startMs).toBe(expectedStart);
    expect(endMs).toBe(expectedEnd);
  });

  it("multi-day from/to widens the window", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([]);
    await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-28",
        tz: "America/New_York",
      }),
    );
    const [, , startMs, endMs] = getCalendarEventsMock.mock.calls[0];
    const expectedStart = Date.UTC(2026, 3, 26, 4);
    const expectedEnd = Date.UTC(2026, 3, 29, 4); // exclusive end of Apr 28
    expect(startMs).toBe(expectedStart);
    expect(endMs).toBe(expectedEnd);
  });

  it("dedupes multiple events for the same contact, keeping the earliest", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c-1", "2026-04-26T15:00:00.000Z", { id: "evt-late" }),
      event("c-1", "2026-04-26T09:00:00.000Z", { id: "evt-early" }),
    ]);
    getContactMock.mockResolvedValueOnce({ id: "c-1", tags: [] });

    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ id: string; appointmentTime: string }>;
    };
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].appointmentTime).toBe("2026-04-26T09:00:00.000Z");
  });

  it("includes a row even if the contact lookup fails (with a warning)", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c-broken", "2026-04-26T10:00:00.000Z"),
    ]);
    getContactMock.mockRejectedValueOnce(new Error("rate limited"));

    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as {
      contacts: Array<{ id: string; tags: string[] }>;
      warnings: string[];
    };
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c-broken");
    expect(body.contacts[0].tags).toEqual([]);
    expect(body.warnings.join(" ")).toContain("Contact c-broken lookup failed");
  });

  it("?from=2026-04-30&to=2026-04-26 → 400", async () => {
    const res = await GET(
      buildRequest({ from: "2026-04-30", to: "2026-04-26" }),
    );
    expect(res.status).toBe(400);
    expect(getCalendarEventsMock).not.toHaveBeenCalled();
  });

  it("?to=… without from → 400", async () => {
    const res = await GET(buildRequest({ to: "2026-04-26" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ghl/pickups/today — discoverySource", () => {
  it("uses the v2 customFields shape over top-level source", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c", "2026-04-26T10:00:00.000Z"),
    ]);
    getContactMock.mockResolvedValueOnce({
      id: "c",
      source: "calendly",
      customFields: [
        { id: "f-other", name: "Other", value: "ignored" },
        { id: "f-disc", name: "discovery_source", value: "Google Ads" },
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ discoverySource: string | null }> };
    expect(body.contacts[0].discoverySource).toBe("Google Ads");
  });

  it("uses the v1 customField fieldKey shape (case-insensitive)", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c", "2026-04-26T10:00:00.000Z"),
    ]);
    getContactMock.mockResolvedValueOnce({
      id: "c",
      customField: [
        { id: "f-disc", fieldKey: "Discovery_Source", value: "Instagram" },
      ],
    });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ discoverySource: string | null }> };
    expect(body.contacts[0].discoverySource).toBe("Instagram");
  });

  it("falls back to top-level source when no custom field matches", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c", "2026-04-26T10:00:00.000Z"),
    ]);
    getContactMock.mockResolvedValueOnce({ id: "c", source: "  Facebook Ads  " });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ discoverySource: string | null }> };
    expect(body.contacts[0].discoverySource).toBe("Facebook Ads");
  });

  it("returns null when neither custom field nor source is set", async () => {
    getCalendarEventsMock.mockResolvedValueOnce([
      event("c", "2026-04-26T10:00:00.000Z"),
    ]);
    getContactMock.mockResolvedValueOnce({ id: "c" });
    const res = await GET(
      buildRequest({
        from: "2026-04-26",
        to: "2026-04-26",
        tz: "America/New_York",
      }),
    );
    const body = (await res.json()) as { contacts: Array<{ discoverySource: string | null }> };
    expect(body.contacts[0].discoverySource).toBeNull();
  });
});
