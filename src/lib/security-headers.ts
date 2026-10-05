type Environment = Record<string, string | undefined>;

export function contentSecurityPolicy(environment: Environment = process.env, nonce?: string) {
  const dev = environment.NODE_ENV !== "production";
  const key = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  const encoded = key.replace(/^pk_(?:test|live)_/, "");
  const domain = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  const clerkOrigin = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(domain) ? `https://${domain}` : "";
  const sources = (values: string[]) => values.filter(Boolean).join(" ");
  const scriptTrust = nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : ["'unsafe-inline'"];
  return [
    "default-src 'self'",
    `script-src ${sources(["'self'", ...scriptTrust, ...(dev ? ["'unsafe-eval'"] : []), clerkOrigin, "https://challenges.cloudflare.com", "https://*.protect.clerk.com"])}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${sources(["'self'", clerkOrigin, "https://clerk-telemetry.com", "https://*.clerk-telemetry.com", "https://*.protect.clerk.com:*", ...(dev ? ["ws://localhost:3000", "ws://127.0.0.1:3000"] : [])])}`,
    `frame-src ${sources(["'self'", clerkOrigin, "https://challenges.cloudflare.com", "https://*.protect.clerk.com", "https://maps.google.com", "https://www.google.com"])}`,
    "media-src 'self' blob: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(environment.VERCEL === "1" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
