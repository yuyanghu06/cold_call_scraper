import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pushPlacesToAttio } from "@/lib/services/attioService";
import { gateAttioRequest } from "@/lib/attio-unlock";
import { enrichPlacesWithIndustry } from "@/lib/services/enrichmentService";
import type { Place } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const gate = await gateAttioRequest(!!session?.user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const places = Array.isArray(b.places) ? (b.places as Place[]) : null;
  const keywords = Array.isArray(b.keywords)
    ? b.keywords.filter((k): k is string => typeof k === "string")
    : [];
  const caller = typeof b.caller === "string" && b.caller.trim() ? b.caller.trim() : null;

  if (!places || places.length === 0)
    return NextResponse.json({ error: "places array required" }, { status: 400 });

  try {
    const enrichment = await enrichPlacesWithIndustry(places, keywords);
    const attio = await pushPlacesToAttio(gate.apiKey!, enrichment.places, { caller });
    return NextResponse.json({
      ...attio,
      enrichedCount: enrichment.places.filter((p) => p.industry).length,
      errors: [...enrichment.errors, ...attio.errors],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
