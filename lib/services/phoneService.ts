import pLimit from "p-limit";
import { lookupPhone } from "@/lib/clients/twilioClient";
import { TWILIO_CONCURRENCY_LIMIT } from "@/lib/constants";
import type { Place } from "@/lib/types";

export async function enrichPlacesWithTwilio(
  accountSid: string,
  authToken: string,
  places: Place[],
): Promise<{ places: Place[]; warnings: string[] }> {
  const limit = pLimit(TWILIO_CONCURRENCY_LIMIT);

  const outcomes = await Promise.all(
    places.map((place) =>
      limit(async () => {
        const phone = place.formattedPhone || place.phone;
        if (!phone) return { place: { ...place, phoneVerified: false as const } };

        const e164 = phone.replace(/[^\d+]/g, "");
        try {
          const result = await lookupPhone(accountSid, authToken, e164);
          if (result === null) return { place: { ...place, phoneVerified: false as const } };
          return {
            place: {
              ...place,
              phoneVerified: result.valid === true,
              phoneLineType: result.line_type_intelligence?.type,
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            place: { ...place, phoneVerified: undefined },
            warning: `Twilio lookup error for ${place.name}: ${msg}`,
          };
        }
      }),
    ),
  );

  const enriched: Place[] = [];
  const warnings: string[] = [];
  for (const o of outcomes) {
    enriched.push(o.place);
    if ("warning" in o && o.warning) warnings.push(o.warning);
  }
  return { places: enriched, warnings };
}
