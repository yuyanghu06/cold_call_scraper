import { NextResponse } from "next/server";
import { auth } from "@/auth";

// API routes should return JSON 401, not redirect to the sign-in HTML page.
// Everything else is a page navigation: redirect to /signin.
export default auth((req) => {
  if (req.auth) return;

  // Bearer-authenticated mobile requests don't have a NextAuth session cookie,
  // so `req.auth` is empty. Let them through and rely on the route handler's
  // `authedUserFromRequest` to verify the Bearer JWT — every route that can
  // be hit this way calls it. Without this skip, every Bearer call 401s here.
  const authz = req.headers.get("authorization");
  if (authz?.toLowerCase().startsWith("bearer ")) return;

  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json(
      { error: "Unauthorized", at: "middleware" },
      { status: 401 },
    );
  }
  const signInUrl = new URL("/signin", req.url);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    "/((?!api/auth|signin|_next/static|_next/image|favicon.ico|logo.jpg).*)",
  ],
};
