import { NextResponse } from "next/server";
import {
  checkAccessPassword,
  clearUnlockCookie,
  getAttioAccessPassword,
  getAttioApiKey,
  hasUnlockCookie,
  issueUnlockCookie,
} from "@/lib/attio-unlock";
import {
  authedUserFromRequest,
  extractBearerToken,
  signMobileSessionJWT,
} from "@/lib/mobileAuth";

export const dynamic = "force-dynamic";

// On the web flow we drive lock state via the unlock cookie. On the iOS flow
// the lock claim lives inside the Bearer JWT, so unlock/lock must mint a
// fresh token reflecting the new state — there's no cookie to mutate.

export async function GET(req: Request) {
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const serverConfigured = !!getAttioApiKey() && !!getAttioAccessPassword();
  if (user.source === "mobile") {
    return NextResponse.json({ unlocked: user.unlocked, serverConfigured });
  }
  return NextResponse.json({
    unlocked: await hasUnlockCookie(),
    serverConfigured,
  });
}

export async function POST(req: Request) {
  const bearer = extractBearerToken(req);
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!getAttioAccessPassword()) {
    return NextResponse.json(
      { error: "Server is missing ATTIO_ACCESS_PASSWORD — contact an admin." },
      { status: 500 },
    );
  }
  if (!getAttioApiKey()) {
    return NextResponse.json(
      { error: "Server is missing ATTIO_API_KEY — contact an admin." },
      { status: 500 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = (body as { password?: unknown })?.password;
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }
  if (!checkAccessPassword(password)) {
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 },
    );
  }

  if (bearer) {
    const token = await signMobileSessionJWT({
      sub: user.email,
      name: user.name,
      picture: user.picture,
      unlocked: true,
    });
    return NextResponse.json({ unlocked: true, token });
  }

  await issueUnlockCookie();
  return NextResponse.json({ unlocked: true });
}

export async function DELETE(req: Request) {
  const bearer = extractBearerToken(req);
  const user = await authedUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (bearer) {
    const token = await signMobileSessionJWT({
      sub: user.email,
      name: user.name,
      picture: user.picture,
      unlocked: false,
    });
    return NextResponse.json({ unlocked: false, token });
  }

  await clearUnlockCookie();
  return NextResponse.json({ unlocked: false });
}
