import type { Place } from "./types";

// One Groq call per lead-gen run. The LLM sees only the search keywords and
// returns a single one-word industry label, which we apply to every place in
// the result set. The assumption: a single search is narrow enough (e.g.
// "tire shop, brake shop, auto repair") that every hit shares one industry.
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const MAX_TOKENS = 32;

export interface EnrichmentResult {
  places: Place[];
  errors: string[];
}

export async function enrichPlacesWithIndustry(
  places: Place[],
  searchKeywords: string[],
): Promise<EnrichmentResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      places,
      errors: [
        "GROQ_API_KEY not set; industry enrichment skipped (Industry column will stay empty)",
      ],
    };
  }
  if (places.length === 0) return { places, errors: [] };
  if (searchKeywords.length === 0) {
    return {
      places,
      errors: [
        "No search keywords provided; industry enrichment skipped (Industry column will stay empty)",
      ],
    };
  }

  try {
    const industry = await classifyKeywords(apiKey, searchKeywords);
    if (!industry) {
      return {
        places,
        errors: [
          "Industry enrichment returned an unusable label; Industry column will stay empty",
        ],
      };
    }
    const enriched = places.map((p) => ({ ...p, industry }));
    return { places: enriched, errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { places, errors: [`industry enrichment failed: ${msg}`] };
  }
}

// Reject anything that isn't a single lowercase word. Lets the Attio push skip
// the field rather than write junk like "not sure" or "auto repair shop".
export function normalizeIndustry(raw: string): string | null {
  const first = raw.trim().toLowerCase().split(/\s+/)[0];
  if (!first) return null;
  const stripped = first.replace(/[^a-z]/g, "");
  if (stripped.length < 2 || stripped.length > 30) return null;
  if (/^(unknown|other|misc|general|n\/?a|none)$/.test(stripped)) return null;
  return stripped;
}

async function classifyKeywords(
  apiKey: string,
  keywords: string[],
): Promise<string | null> {
  const systemPrompt = [
    "You classify a set of small-business search keywords into a single industry label.",
    "",
    "Output rules:",
    '- Exactly one lowercase English word (e.g. "automotive", "wholesale", "plumbing", "restaurant", "healthcare", "construction", "retail", "logistics", "landscaping", "hvac", "cleaning", "manufacturing", "electrical").',
    "- No punctuation, spaces, hyphens, or underscores inside the label.",
    '- Never output "unknown", "other", "misc", "general", or "n/a" — always pick the closest concrete match.',
    "- Return valid JSON only. Do not wrap in markdown fences or include any commentary.",
  ].join("\n");

  const userPrompt =
    `A sales operator searched Google Places for these keywords: "${keywords.join(", ")}".\n\n` +
    `What single-word industry label best describes the businesses they're looking for?\n\n` +
    `Return JSON in this exact shape: {"industry": "word"}`;

  const res = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${text.slice(0, 240)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq response had no content");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("industry" in parsed) ||
    typeof (parsed as { industry: unknown }).industry !== "string"
  ) {
    throw new Error("response missing 'industry' string");
  }
  return normalizeIndustry((parsed as { industry: string }).industry);
}
