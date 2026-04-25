import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.GHL_API_KEY = "test-ghl-key";
  process.env.GHL_LOCATION_ID = "loc-123";
  process.env.GHL_API_BASE = "https://services.example.com";
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

interface FetchCall {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

function recordCall(args: Parameters<typeof fetch>): FetchCall {
  const [input, init] = args;
  const url = typeof input === "string" ? input : (input as URL).toString();
  const method = (init?.method ?? "GET").toUpperCase();
  let body: unknown = undefined;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  const headersIn = init?.headers ?? {};
  const headers: Record<string, string> = {};
  if (headersIn instanceof Headers) {
    headersIn.forEach((v, k) => (headers[k.toLowerCase()] = v));
  } else {
    for (const [k, v] of Object.entries(headersIn as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
  }
  return { method, url, body, headers };
}

describe("swapCalendlyTags", () => {
  it("removes calendly-bookings, removes the opposite tag, then adds the target — picked_up", async () => {
    const calls: FetchCall[] = [];
    fetchMock.mockImplementation(async (...args: Parameters<typeof fetch>) => {
      const c = recordCall(args);
      calls.push(c);
      if (c.method === "POST") return jsonResponse({ tags: ["picked_up"] });
      return jsonResponse({ tags: [] });
    });

    const { swapCalendlyTags } = await import("@/lib/clients/ghlClient");
    const tags = await swapCalendlyTags("contact-1", "picked_up", "loc-123");
    expect(tags).toEqual(["picked_up"]);

    expect(calls).toHaveLength(3);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("/contacts/contact-1/tags");
    expect(calls[0].body).toEqual({ tags: ["calendly-bookings"] });
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].body).toEqual({ tags: ["no_pickup"] });
    expect(calls[2].method).toBe("POST");
    expect(calls[2].body).toEqual({ tags: ["picked_up"] });

    // Common headers
    for (const c of calls) {
      expect(c.headers.authorization).toBe("Bearer test-ghl-key");
      expect(c.headers.version).toBe("2021-07-28");
    }
  });

  it("removes calendly-bookings, removes the opposite tag, then adds the target — no_pickup", async () => {
    const calls: FetchCall[] = [];
    fetchMock.mockImplementation(async (...args: Parameters<typeof fetch>) => {
      const c = recordCall(args);
      calls.push(c);
      if (c.method === "POST") return jsonResponse({ tags: ["no_pickup"] });
      return jsonResponse({ tags: [] });
    });

    const { swapCalendlyTags } = await import("@/lib/clients/ghlClient");
    const tags = await swapCalendlyTags("contact-2", "no_pickup", "loc-123");
    expect(tags).toEqual(["no_pickup"]);

    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ["DELETE", { tags: ["calendly-bookings"] }],
      ["DELETE", { tags: ["picked_up"] }],
      ["POST", { tags: ["no_pickup"] }],
    ]);
  });

  it("is idempotent — running twice still yields a clean POST add at the end", async () => {
    fetchMock.mockImplementation(async (..._args: Parameters<typeof fetch>) =>
      jsonResponse({ tags: ["picked_up"] }),
    );
    const { swapCalendlyTags } = await import("@/lib/clients/ghlClient");
    await swapCalendlyTags("c", "picked_up", "loc-123");
    await swapCalendlyTags("c", "picked_up", "loc-123");
    // Two swaps × 3 calls each = 6.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("propagates errors from the underlying GHL request", async () => {
    fetchMock.mockResolvedValue(
      new Response("nope", { status: 400 }),
    );
    const { swapCalendlyTags } = await import("@/lib/clients/ghlClient");
    await expect(
      swapCalendlyTags("c", "picked_up", "loc-123"),
    ).rejects.toThrow(/GHL 400/);
  });
});
