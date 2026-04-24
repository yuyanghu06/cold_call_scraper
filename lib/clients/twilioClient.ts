const LOOKUP_BASE = "https://lookups.twilio.com/v2/PhoneNumbers";

export interface TwilioLookupResponse {
  valid?: boolean;
  line_type_intelligence?: { type?: string };
  phone_number?: string;
}

function buildAuthHeader(sid: string, token: string): string {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

export async function lookupPhone(
  accountSid: string,
  authToken: string,
  e164: string,
): Promise<TwilioLookupResponse | null> {
  const url = `${LOOKUP_BASE}/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;
  const res = await fetch(url, {
    headers: { Authorization: buildAuthHeader(accountSid, authToken) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio ${res.status}: ${text.slice(0, 120)}`);
  }
  return (await res.json()) as TwilioLookupResponse;
}
