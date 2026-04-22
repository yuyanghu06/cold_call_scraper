import { NextResponse } from "next/server";
import { auth } from "@/auth";

// API routes should return JSON 401, not redirect to the sign-in HTML page.
// Everything else is a page navigation: redirect to /signin.
export default auth((req) => {
  if (req.auth) return;
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const signInUrl = new URL("/signin", req.url);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    "/((?!api/auth|signin|_next/static|_next/image|favicon.ico|logo.jpg).*)",
  ],
};
