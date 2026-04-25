import { NextResponse } from "next/server";
import { authedUserFromRequest } from "@/lib/mobileAuth";
import { getLocation, getLocationId } from "@/lib/clients/ghlClient";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const locationId = getLocationId();
    const location = await getLocation(locationId);
    return NextResponse.json({ ok: true, location });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
