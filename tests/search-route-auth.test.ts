import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock `@/auth` BEFORE importing the route. `vi.mock` is hoisted above
// imports, so we must share the mock fn via `vi.hoisted` — otherwise the
// factory runs before the `authMock` const exists.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({
  auth: authMock,
}));

// Also mock the heavy downstream libs so we never hit the network if something
// about these assertions is wrong (defense in depth for the test itself).
vi.mock("@/lib/geocode", () => ({
  geocodeLocation: vi.fn(async () => ({ lat: 40.73, lng: -73.99 })),
  GeocodeNoMatchError: class extends Error {},
}));
vi.mock("@/lib/google-places", () => ({
  searchPlacesParallel: vi.fn(async () => ({ results: [], errors: [] })),
}));
vi.mock("@/lib/twilio-lookup", () => ({
  enrichPlacesWithTwilio: vi.fn(async (_s: string, _t: string, places) => ({
    places,
    warnings: [],
  })),
}));

import { POST } from "@/app/api/search/route";

function buildRequest(body: object): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/search — auth gate", () => {
  beforeEach(() => {
    authMock.mockReset();
    // Keep env required by the route from short-circuiting before the auth check.
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    process.env.NOMINATIM_USER_AGENT = "test-agent/1.0 (t@t.com)";
  });

  it("returns 401 when there is no session", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      buildRequest({
        keywords: ["auto repair"],
        location: "10003",
        radiusMeters: 1000,
        excludeChains: [],
        runTwilioLookup: false,
      }),
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Unauthorized");
  });

  it("does not invoke the geocoder or Places client when unauthorized", async () => {
    authMock.mockResolvedValue(null);
    const geocode = await import("@/lib/geocode");
    const places = await import("@/lib/google-places");

    await POST(
      buildRequest({
        keywords: ["auto repair"],
        location: "10003",
        radiusMeters: 1000,
        excludeChains: [],
        runTwilioLookup: false,
      }),
    );

    expect(geocode.geocodeLocation).not.toHaveBeenCalled();
    expect(places.searchPlacesParallel).not.toHaveBeenCalled();
  });

  it("proceeds past the auth check when a session is present", async () => {
    // Not asserting the full happy path — just that we get past 401 and into
    // the pipeline (which our mocks make return an empty result).
    authMock.mockResolvedValue({
      user: { email: "ops@micro-agi.com" },
      expires: "2099-01-01",
    });

    const res = await POST(
      buildRequest({
        keywords: ["auto repair"],
        location: "10003",
        radiusMeters: 1000,
        excludeChains: [],
        runTwilioLookup: false,
      }),
    );
    expect(res.status).not.toBe(401);
  });

  it("returns 401 before even parsing the request body", async () => {
    // Malformed JSON must not trump the auth check — otherwise an attacker
    // could probe shapes of the endpoint without authenticating.
    authMock.mockResolvedValue(null);
    const req = new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
