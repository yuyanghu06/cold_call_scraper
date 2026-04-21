import pLimit from "p-limit";
import type { Place } from "./types";
import { TWILIO_CONCURRENCY_LIMIT } from "./constants";

const LOOKUP_BASE = "https://lookups.twilio.com/v2/PhoneNumbers";

interface TwilioLookupResponse {
  valid?: boolean;
  line_type_intelligence?: {
    type?: string;
    carrier_name?: string;
  };
  phone_number?: string;
}

export interface TwilioEnrichmentResult {
  place: Place;
  warning?: string;
}

function buildAuthHeader(sid: string, token: string): string {
  const encoded = Buffer.from(`${sid}:${token}`).toString("base64");
  return `Basic ${encoded}`;
}

async function lookupSingle(
  accountSid: string,
  authToken: string,
  place: Place,
): Promise<TwilioEnrichmentResult> {
  const phone = place.formattedPhone || place.phone;
  if (!phone) {
    return { place: { ...place, phoneVerified: false } };
  }

  const e164 = phone.replace(/[^\d+]/g, "");
  const url = `${LOOKUP_BASE}/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: buildAuthHeader(accountSid, authToken),
      },
    });

    if (res.status === 404) {
      return { place: { ...place, phoneVerified: false } };
    }

    if (!res.ok) {
      const text = await res.text();
      return {
        place: { ...place, phoneVerified: undefined },
        warning: `Twilio lookup failed for ${place.name} (${e164}): ${res.status} ${text.slice(0, 120)}`,
      };
    }

    const body = (await res.json()) as TwilioLookupResponse;
    const valid = body.valid === true;
    const lineType = body.line_type_intelligence?.type;
    return {
      place: {
        ...place,
        phoneVerified: valid,
        phoneLineType: lineType,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      place: { ...place, phoneVerified: undefined },
      warning: `Twilio lookup error for ${place.name}: ${msg}`,
    };
  }
}

export async function enrichPlacesWithTwilio(
  accountSid: string,
  authToken: string,
  places: Place[],
): Promise<{ places: Place[]; warnings: string[] }> {
  const limit = pLimit(TWILIO_CONCURRENCY_LIMIT);
  const tasks = places.map((p) =>
    limit(() => lookupSingle(accountSid, authToken, p)),
  );
  const outcomes = await Promise.all(tasks);
  const enriched: Place[] = [];
  const warnings: string[] = [];
  for (const o of outcomes) {
    enriched.push(o.place);
    if (o.warning) warnings.push(o.warning);
  }
  return { places: enriched, warnings };
}
