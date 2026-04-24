import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateTrackingCompany } from "@/lib/services/attioService";
import { gateAttioRequest } from "@/lib/attio-unlock";
import type { TrackingUpdate } from "@/lib/viewmodels/trackingViewModel";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const gate = await gateAttioRequest(!!session?.user);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Record id required" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;

  function readOptionalText(v: unknown): string | null {
    if (v === null) return null;
    if (typeof v !== "string") return null;
    return v;
  }

  const update: TrackingUpdate = {};
  if (b.name !== undefined) {
    if (typeof b.name !== "string" || !b.name.trim())
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    update.name = b.name;
  }
  if (b.territory !== undefined) {
    if (!Array.isArray(b.territory))
      return NextResponse.json({ error: "territory must be an array" }, { status: 400 });
    update.territory = b.territory.filter((s): s is string => typeof s === "string");
  }
  if (b.callStatus !== undefined) update.callStatus = readOptionalText(b.callStatus);
  if (b.industry !== undefined) update.industry = readOptionalText(b.industry);
  if (b.address !== undefined) update.address = readOptionalText(b.address);
  if (b.ownerName !== undefined) update.ownerName = readOptionalText(b.ownerName);
  if (b.followUpNumber !== undefined) update.followUpNumber = readOptionalText(b.followUpNumber);
  if (b.notes !== undefined) update.notes = readOptionalText(b.notes);

  try {
    const updated = await updateTrackingCompany(gate.apiKey!, id, update);
    return NextResponse.json({ company: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
