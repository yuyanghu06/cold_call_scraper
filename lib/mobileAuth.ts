// Mobile auth helpers for the FieldAGIUSA iOS app.
//
// The iOS app cannot use NextAuth's HTTP-only session cookie, so it carries a
// JWT in the `Authorization: Bearer <token>` header. We sign these with the
// same `AUTH_SECRET` as the unlock cookie (HS256). The JWT carries the user's
// email and a snapshot of their Attio unlock state — bumping the unlock state
// requires a fresh token (see /api/attio/unlock).
//
// Every API route that previously did `auth() + gateAttioRequest(hasSession)`
// should call `authedUserFromRequest(req)` instead. It checks the Bearer
// header first and falls back to the NextAuth cookie session, so the web flow
// stays unchanged.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { auth } from "@/auth";
import { getAttioApiKey, hasUnlockCookie } from "@/lib/attio-unlock";

const ALG = "HS256";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const REFRESH_THRESHOLD_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ISSUER = "microagi.cold-call-scraper";
const AUDIENCE = "fieldagiusa.mobile";

export interface MobileSessionClaims {
  sub: string;
  unlocked: boolean;
  name?: string;
  picture?: string;
}

interface MobileSessionPayload extends JWTPayload {
  sub: string;
  unlocked: boolean;
  name?: string;
  picture?: string;
}

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(raw);
}

export async function signMobileSessionJWT(
  payload: MobileSessionClaims,
): Promise<string> {
  const body: Record<string, unknown> = {
    unlocked: payload.unlocked,
  };
  if (payload.name) body.name = payload.name;
  if (payload.picture) body.picture = payload.picture;
  return new SignJWT(body)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyMobileSessionJWT(
  token: string,
): Promise<(MobileSessionClaims & { exp: number; iat: number }) | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const p = payload as MobileSessionPayload;
    if (typeof p.sub !== "string" || !p.sub) return null;
    if (typeof p.unlocked !== "boolean") return null;
    if (typeof p.exp !== "number" || typeof p.iat !== "number") return null;
    return {
      sub: p.sub,
      unlocked: p.unlocked,
      name: typeof p.name === "string" ? p.name : undefined,
      picture: typeof p.picture === "string" ? p.picture : undefined,
      exp: p.exp,
      iat: p.iat,
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export interface AuthedUser {
  email: string;
  unlocked: boolean;
  source: "cookie" | "mobile";
  name?: string;
  picture?: string;
}

export interface AttioGateOk {
  ok: true;
  user: AuthedUser;
  apiKey: string;
}
export interface AttioGateFail {
  ok: false;
  status: number;
  error: string;
}
export type AttioGateResult = AttioGateOk | AttioGateFail;

// Combined check: 401 if no auth, 403 if not unlocked, 500 if server is
// missing ATTIO_API_KEY. Same end state for both Bearer and cookie callers.
export async function gateAttioFromRequest(
  req: Request,
): Promise<AttioGateResult> {
  const user = await authedUserFromRequest(req);
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };
  if (!user.unlocked) {
    return {
      ok: false,
      status: 403,
      error: "Attio access is locked. Enter the access password in Settings.",
    };
  }
  const apiKey = getAttioApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      error: "Server is missing ATTIO_API_KEY — contact an admin.",
    };
  }
  return { ok: true, user, apiKey };
}

// Bearer first, then NextAuth cookie. Returns null if neither is valid.
export async function authedUserFromRequest(
  req: Request,
): Promise<AuthedUser | null> {
  const bearer = extractBearerToken(req);
  if (bearer) {
    const claims = await verifyMobileSessionJWT(bearer);
    if (!claims) return null;
    return {
      email: claims.sub,
      unlocked: claims.unlocked,
      source: "mobile",
      name: claims.name,
      picture: claims.picture,
    };
  }

  const session = await auth();
  if (!session?.user) return null;
  // Email is the canonical identifier for the mobile JWT subject, but the
  // cookie path just needs to know the user is authed. Fall back to name so
  // a session without an email claim still passes the gate it passed before.
  const email =
    (typeof session.user.email === "string" && session.user.email) ||
    (typeof session.user.name === "string" && session.user.name) ||
    "";
  return {
    email,
    unlocked: await hasUnlockCookie(),
    source: "cookie",
    name: session.user.name ?? undefined,
    picture: session.user.image ?? undefined,
  };
}
