import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listAttributeOptions, SLUG } from "@/lib/services/attioService";
import { gateAttioRequest } from "@/lib/attio-unlock";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ALLOWED: Record<string, string> = {
  territory: SLUG.territory,
  callStatus: SLUG.callStatus,
  stage: SLUG.stage,
  caller: SLUG.caller,
};

export async function GET(req: Request) {
  const session = await auth();
  const gate = await gateAttioRequest(!!session?.user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const url = new URL(req.url);
  const attr = url.searchParams.get("attribute");
  if (!attr || !(attr in ALLOWED))
    return NextResponse.json({ error: "attribute must be 'territory', 'callStatus', 'stage', or 'caller'" }, { status: 400 });

  try {
    const options = await listAttributeOptions(gate.apiKey!, ALLOWED[attr]);
    return NextResponse.json({ options });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
