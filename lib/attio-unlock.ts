import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// Signed cookie that proves a user has passed the Attio password gate.
// Content is a fixed marker ("u": true) — the signature is what matters.
// Cookie is HTTP-only so the client can't mint one; TTL is 30 days.

const COOKIE_NAME = "microagi.attio.unlock";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ALG = "HS256";

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(raw);
}

export function getAttioApiKey(): string | null {
  const raw = process.env.ATTIO_API_KEY;
  if (!raw || !raw.trim()) return null;
  return raw.trim();
}

export function getAttioAccessPassword(): string | null {
  const raw = process.env.ATTIO_ACCESS_PASSWORD;
  if (!raw || raw.length === 0) return null;
  return raw;
}

// Constant-time compare to avoid timing leaks on short inputs.
export function checkAccessPassword(attempt: string): boolean {
  const expected = getAttioAccessPassword();
  if (!expected) return false;
  const a = Buffer.from(attempt);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signUnlockToken(): Promise<string> {
  return new SignJWT({ u: true })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

export async function issueUnlockCookie(): Promise<void> {
  const token = await signUnlockToken();
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearUnlockCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function hasUnlockCookie(): Promise<boolean> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return false;
  try {
    await jwtVerify(raw, getSecret(), { algorithms: [ALG] });
    return true;
  } catch {
    return false;
  }
}

export interface AttioGateResult {
  ok: boolean;
  error?: string;
  status?: number;
  apiKey?: string;
}

// Combined check for every Attio-touching API route: must be signed in, must
// have a valid unlock cookie, and server must have ATTIO_API_KEY configured.
export async function gateAttioRequest(
  hasSession: boolean,
): Promise<AttioGateResult> {
  if (!hasSession) return { ok: false, status: 401, error: "Unauthorized" };
  if (!(await hasUnlockCookie())) {
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
  return { ok: true, apiKey };
}
