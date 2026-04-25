import { NextResponse } from "next/server";
import {
  createAttributeOption,
  listAttributeOptions,
  SLUG,
} from "@/lib/services/attioService";
import { gateAttioFromRequest } from "@/lib/mobileAuth";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = {
  territory: SLUG.territory,
  callStatus: SLUG.callStatus,
  stage: SLUG.stage,
  caller: SLUG.caller,
};

export async function GET(req: Request) {
  const gate = await gateAttioFromRequest(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(req.url);
  const attr = url.searchParams.get("attribute");
  if (!attr || !(attr in ALLOWED))
    return NextResponse.json({ error: "attribute must be 'territory', 'callStatus', 'stage', or 'caller'" }, { status: 400 });

  try {
    const options = await listAttributeOptions(gate.apiKey, ALLOWED[attr]);
    return NextResponse.json({ options });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
  const attr = typeof b.attribute === "string" ? b.attribute : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!attr || !(attr in ALLOWED)) {
    return NextResponse.json(
      { error: "attribute must be 'territory', 'callStatus', 'stage', or 'caller'" },
      { status: 400 },
    );
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const created = await createAttributeOption(gate.apiKey, ALLOWED[attr], title);
    const options = await listAttributeOptions(gate.apiKey, ALLOWED[attr]);
    return NextResponse.json({ created, options });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
