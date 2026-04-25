// Refresh a mobile session JWT before it expires.
//
// Returns a new token with the same claims if the existing one is valid and
// within 7 days of expiry. If the old token is still fresh, we still mint a
// new one — clients can call this whenever they want a longer-lived token.

import { NextResponse } from "next/server";
import {
  REFRESH_THRESHOLD_SECONDS,
  extractBearerToken,
  signMobileSessionJWT,
  verifyMobileSessionJWT,
} from "@/lib/mobileAuth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bearer = extractBearerToken(req);
  if (!bearer) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const claims = await verifyMobileSessionJWT(bearer);
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const secondsLeft = claims.exp - nowSec;
  if (secondsLeft <= 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Spec: refresh when within 7 days of expiry. If the token still has more
  // than 7 days, hand back the existing token unchanged so callers don't
  // accidentally bloat their token rotation.
  if (secondsLeft > REFRESH_THRESHOLD_SECONDS) {
    return NextResponse.json({ token: bearer });
  }

  const token = await signMobileSessionJWT({
    sub: claims.sub,
    name: claims.name,
    picture: claims.picture,
    unlocked: claims.unlocked,
  });
  return NextResponse.json({ token });
}
