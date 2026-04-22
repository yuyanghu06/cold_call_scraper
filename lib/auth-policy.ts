// Access policy for Google OAuth sign-in.
//
// A user is allowed in if EITHER:
//   (a) Google's signed ID token reports `hd === AUTH_ALLOWED_DOMAIN`
//       — i.e. they're in our Workspace org — or
//   (b) their verified Google email is in AUTH_ALLOWED_EMAILS (an explicit
//       invite list for outside collaborators).
//
// `hd` is the Workspace "hosted domain" claim — Google-signed, not spoofable.
// Personal Gmail accounts have no `hd` at all, so they can only get in via
// the email allowlist.

type Profile =
  | {
      hd?: unknown;
      email?: unknown;
    }
  | undefined
  | null;

export function isAllowedDomain(
  profile: Profile,
  allowedDomain: string,
): boolean {
  if (!profile) return false;
  if (!allowedDomain) return false;
  return profile.hd === allowedDomain;
}

export function isAllowedEmail(
  profile: Profile,
  allowedEmails: Set<string>,
): boolean {
  if (!profile) return false;
  if (allowedEmails.size === 0) return false;
  const email = profile.email;
  if (typeof email !== "string" || !email) return false;
  return allowedEmails.has(email.trim().toLowerCase());
}

export function isAllowed(
  profile: Profile,
  policy: { allowedDomain: string; allowedEmails: Set<string> },
): boolean {
  return (
    isAllowedDomain(profile, policy.allowedDomain) ||
    isAllowedEmail(profile, policy.allowedEmails)
  );
}

export function getAllowedDomain(): string {
  return process.env.AUTH_ALLOWED_DOMAIN ?? "micro-agi.com";
}

export function getAllowedEmails(): Set<string> {
  const raw = process.env.AUTH_ALLOWED_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
