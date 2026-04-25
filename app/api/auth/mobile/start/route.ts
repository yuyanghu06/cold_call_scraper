// Step 1 of the iOS Google OAuth flow: redirect the user to Google with a
// state nonce we control. The same `state` is round-tripped via a short-lived
// signed cookie so the callback can verify the redirect came from this start.

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "microagi.mobileAuthState";
const STATE_TTL_SECONDS = 60 * 10; // 10 minutes
const ALG = "HS256";

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(raw);
}

export async function GET(req: Request) {
  const clientId = process.env.AUTH_GOOGLE_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Server is missing AUTH_GOOGLE_ID" },
      { status: 500 },
    );
  }

  const state = randomBytes(32).toString("hex");
  const cookie = await new SignJWT({ s: state })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(getSecret());

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/mobile/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(authUrl.toString(), 302);
  res.cookies.set({
    name: STATE_COOKIE,
    value: cookie,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/mobile",
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
