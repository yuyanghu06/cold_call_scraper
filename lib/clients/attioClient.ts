const ATTIO_BASE = "https://api.attio.com/v2";
const MAX_ATTEMPTS = 4;

export type AttioValueEntry = Record<string, unknown>;

export interface AttioRecord {
  id: { record_id: string };
  values: Record<string, AttioValueEntry[] | undefined>;
}

export function parseRetryAfter(header: string | null, fallbackMs: number): number {
  if (!header) return fallbackMs;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.ceil(asSeconds * 1000);
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return fallbackMs;
}

export function createPacer(intervalMs: number): () => Promise<void> {
  let nextAllowedAt = 0;
  return async () => {
    const now = Date.now();
    const slot = Math.max(now, nextAllowedAt);
    nextAllowedAt = slot + intervalMs;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function attioRequest(
  apiKey: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: unknown,
  pace: () => Promise<void>,
): Promise<Response> {
  const serialized = body === undefined ? undefined : JSON.stringify(body);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pace();
    const res = await fetch(`${ATTIO_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: serialized,
    });
    if (res.ok) return res;

    const isLast = attempt === MAX_ATTEMPTS;
    if (res.status === 429 && !isLast) {
      await sleep(parseRetryAfter(res.headers.get("retry-after"), 2000));
      continue;
    }
    if (res.status >= 500 && res.status < 600 && !isLast) {
      await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Attio ${res.status}: ${text.slice(0, 240)}`);
  }
  throw new Error("Attio: retries exhausted");
}
