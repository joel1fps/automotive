// Only server-returned Clerk data may be passed here. unsafeMetadata is deliberately ignored.
export function serverRole(
  metadata: Record<string, unknown>,
  email: string | undefined,
  verified: boolean,
  allowlist: string[],
): "admin" | "client" {
  return metadata.role === "admin" ||
    (verified && !!email && allowlist.includes(email.toLowerCase()))
    ? "admin"
    : "client";
}
