import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getAllowedDomain, isAllowedDomain } from "@/lib/auth-policy";

const ALLOWED_DOMAIN = getAllowedDomain();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // `hd` asks Google to only show the consent screen to accounts in this
      // Workspace domain. A malicious client can strip it before redirecting,
      // so the `signIn` callback below is the real gate.
      authorization: { params: { hd: ALLOWED_DOMAIN } },
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      // NextAuth types `profile` as the generic OIDC Profile which doesn't
      // declare `hd`. For Google it's always present on Workspace accounts.
      return isAllowedDomain(
        profile as { hd?: unknown } | undefined,
        ALLOWED_DOMAIN,
      );
    },
  },
  pages: {
    signIn: "/signin",
  },
});
