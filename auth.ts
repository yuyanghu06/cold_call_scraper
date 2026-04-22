import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import {
  getAllowedDomain,
  getAllowedEmails,
  isAllowed,
} from "@/lib/auth-policy";

// Snapshot at module load. Changing env vars requires a server restart.
const ALLOWED_DOMAIN = getAllowedDomain();
const ALLOWED_EMAILS = getAllowedEmails();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // No `hd` param — we want users from outside the Workspace domain to be
  // able to reach the consent screen if they're on the email allowlist.
  // Google only blocks unverified OAuth clients; domain gating happens below.
  providers: [Google],
  callbacks: {
    async signIn({ profile }) {
      // NextAuth types `profile` as a generic OIDC shape without `hd`/`email`.
      // Google always includes both on its signed ID token.
      return isAllowed(
        profile as { hd?: unknown; email?: unknown } | undefined,
        { allowedDomain: ALLOWED_DOMAIN, allowedEmails: ALLOWED_EMAILS },
      );
    },
  },
  pages: {
    signIn: "/signin",
  },
});
