import { NextResponse } from "next/server";
import { normalizeTerritory, pushCsvRowsToAttio, SLUG } from "@/lib/services/attioService";
import { gateAttioFromRequest } from "@/lib/mobileAuth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  const gate = await gateAttioFromRequest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const name = asString(b.name);
  if (!name) return NextResponse.json({ error: "Business name is required" }, { status: 400 });

  const values: Record<string, unknown> = { [SLUG.name]: name };
  const industry = asString(b.industry);
  if (industry) values[SLUG.industry] = industry;
  const territory = asString(b.territory);
  if (territory) values[SLUG.territory] = [normalizeTerritory(territory)];
  const stage = asString(b.stage);
  if (stage) values[SLUG.stage] = stage;
  values[SLUG.callStatus] = asString(b.result) ?? "Not called yet";
  const ownerName = asString(b.ownerName);
  if (ownerName) values[SLUG.ownerName] = ownerName;
  const followUpNumber = asString(b.followUpNumber);
  if (followUpNumber) values[SLUG.followUpNumber] = followUpNumber;
  const caller = asString(b.caller);
  if (caller) values[SLUG.caller] = caller;
  const notes = asString(b.notes);
  if (notes) values[SLUG.notes] = notes;

  try {
    const outcome = await pushCsvRowsToAttio(gate.apiKey, [{ values }]);
    return NextResponse.json(outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
