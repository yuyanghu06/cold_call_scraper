import { classifyKeywords } from "@/lib/clients/groqClient";
import type { Place } from "@/lib/types";

export function normalizeIndustry(raw: string): string | null {
  const first = raw.trim().toLowerCase().split(/\s+/)[0];
  if (!first) return null;
  const stripped = first.replace(/[^a-z]/g, "");
  if (stripped.length < 2 || stripped.length > 30) return null;
  if (/^(unknown|other|misc|general|n\/?a|none)$/.test(stripped)) return null;
  return stripped;
}

export async function enrichPlacesWithIndustry(
  places: Place[],
  searchKeywords: string[],
): Promise<{ places: Place[]; errors: string[] }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { places, errors: ["GROQ_API_KEY not set; industry enrichment skipped"] };
  }
  if (places.length === 0) return { places, errors: [] };
  if (searchKeywords.length === 0) {
    return { places, errors: ["No keywords provided; industry enrichment skipped"] };
  }

  try {
    const raw = await classifyKeywords(apiKey, searchKeywords);
    const industry = raw ? normalizeIndustry(raw) : null;
    if (!industry) {
      return { places, errors: ["Industry enrichment returned an unusable label; skipped"] };
    }
    return { places: places.map((p) => ({ ...p, industry })), errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { places, errors: [`Industry enrichment failed: ${msg}`] };
  }
}
