// Step 2 of the iOS Google OAuth flow. Google redirected the browser back to
// us with `code` + `state`. We:
//   1. verify the `state` against our short-lived signed cookie,
//   2. swap the `code` for tokens at Google's token endpoint,
//   3. JWT-decode the ID token (it's transported over TLS straight from
//      Google, so signature verification is belt-and-suspenders only),
//   4. run `isAllowed` from auth-policy — same gate as the web flow,
//   5. mint our own mobile JWT and 302 to the iOS deep link.

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  getAllowedDomain,
  getAllowedEmails,
  isAllowed,
} from "@/lib/auth-policy";
import { signMobileSessionJWT } from "@/lib/mobileAuth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "microagi.mobileAuthState";
const ALG = "HS256";
const APP_DEEP_LINK = "fieldagiusa://auth/callback";

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(raw);
}

interface GoogleTokenResponse {
  id_token?: string;
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface GoogleIdClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string;
}

function decodeJwtPayload(token: string): GoogleIdClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json) as GoogleIdClaims;
  } catch {
    return null;
  }
}

function clearStateCookie(res: NextResponse): void {
  res.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/mobile",
    maxAge: 0,
  });
}

function appRedirect(params: Record<string, string>): NextResponse {
  const url = new URL(APP_DEEP_LINK);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url.toString(), 302);
  clearStateCookie(res);
  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return appRedirect({ error: oauthError });
  }
  if (!code || !state) {
    return appRedirect({ error: "missing_code_or_state" });
  }

  const cookieRaw = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  if (!cookieRaw) {
    return appRedirect({ error: "missing_state_cookie" });
  }

  let expectedState: string | null = null;
  try {
    const { payload } = await jwtVerify(
      decodeURIComponent(cookieRaw),
      getSecret(),
      { algorithms: [ALG] },
    );
    if (typeof payload.s === "string") expectedState = payload.s;
  } catch {
    return appRedirect({ error: "bad_state_cookie" });
  }
  if (!expectedState || expectedState !== state) {
    return appRedirect({ error: "state_mismatch" });
  }

  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    return appRedirect({ error: "server_misconfigured" });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/auth/mobile/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return appRedirect({ error: "token_exchange_failed" });
  }
  const tokens = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokens.id_token) {
    return appRedirect({ error: "no_id_token" });
  }

  const claims = decodeJwtPayload(tokens.id_token);
  if (!claims || typeof claims.email !== "string") {
    return appRedirect({ error: "bad_id_token" });
  }
  if (claims.email_verified === false) {
    return appRedirect({ error: "email_not_verified" });
  }

  const allowed = isAllowed(
    { hd: claims.hd, email: claims.email },
    {
      allowedDomain: getAllowedDomain(),
      allowedEmails: getAllowedEmails(),
    },
  );
  if (!allowed) {
    return appRedirect({ error: "not_allowed" });
  }

  const token = await signMobileSessionJWT({
    sub: claims.email,
    name: claims.name,
    picture: claims.picture,
    unlocked: false,
  });
  return appRedirect({ token });
}
