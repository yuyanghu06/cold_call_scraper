// Domain gate for Google OAuth. The `hd` ("hosted domain") claim is set by Google
// on ID tokens for Workspace accounts and is cryptographically signed — the
// client cannot spoof it. Plain-Gmail accounts have no `hd` at all.
//
// We intentionally do NOT fall back to `profile.email.endsWith("@domain")` —
// that string is also signed, but `hd` is the explicit Workspace signal and
// sidesteps any weird edge case with email aliases.
export function isAllowedDomain(
  profile: { hd?: unknown } | undefined | null,
  allowedDomain: string,
): boolean {
  if (!profile) return false;
  if (!allowedDomain) return false;
  return profile.hd === allowedDomain;
}

export function getAllowedDomain(): string {
  return process.env.AUTH_ALLOWED_DOMAIN ?? "micro-agi.com";
}
