import { NextResponse } from "next/server";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import { getLocationId, swapCalendlyTags } from "@/lib/clients/ghlClient";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Contact id required" }, { status: 400 });
  }
  let locationId: string;
  try {
    locationId = getLocationId();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  try {
    const tags = await swapCalendlyTags(id, "no_pickup", locationId);
    return NextResponse.json({ ok: true, tags });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
