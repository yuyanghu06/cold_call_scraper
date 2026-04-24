import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  checkAccessPassword,
  clearUnlockCookie,
  getAttioAccessPassword,
  getAttioApiKey,
  hasUnlockCookie,
  issueUnlockCookie,
} from "@/lib/attio-unlock";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    unlocked: await hasUnlockCookie(),
    serverConfigured: !!getAttioApiKey() && !!getAttioAccessPassword(),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
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
  await issueUnlockCookie();
  return NextResponse.json({ unlocked: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await clearUnlockCookie();
  return NextResponse.json({ unlocked: false });
}
