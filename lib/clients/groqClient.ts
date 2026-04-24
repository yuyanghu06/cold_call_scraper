const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";
const MAX_TOKENS = 32;

export async function classifyKeywords(
  apiKey: string,
  keywords: string[],
): Promise<string | null> {
  const systemPrompt = [
    "You classify a set of small-business search keywords into a single industry label.",
    "",
    "Output rules:",
    '- Exactly one lowercase English word (e.g. "automotive", "plumbing", "hvac", "cleaning", "logistics").',
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
    throw new Error(`Groq response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("industry" in parsed) ||
    typeof (parsed as { industry: unknown }).industry !== "string"
  ) {
    throw new Error("Groq response missing 'industry' string");
  }

  return (parsed as { industry: string }).industry;
}
