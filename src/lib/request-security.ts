import { createHash } from "node:crypto";
import { AppError, assert } from "./domain";

export const MAX_REQUEST_BYTES = 300000;
type Environment = Record<string, string | undefined>;

// Only operator-controlled configuration may authorize a Clerk token origin.
// Never derive this allowlist from Host, Origin or forwarded host headers.
export function allowedOrigins(environment: Environment = process.env) {
  const onVercel = environment.VERCEL === "1";
  const sources = [
    environment.NEXT_PUBLIC_SITE_URL,
    ...(environment.ALLOWED_ORIGINS || "").split(","),
    ...[environment.VERCEL_URL, environment.VERCEL_BRANCH_URL].filter(Boolean).map(value => `https://${value}`),
    ...(!onVercel && environment.NODE_ENV !== "production" ? ["http://localhost:3000"] : []),
  ];
  const origins = new Set<string>();
  for (const source of sources) {
    if (!source?.trim()) continue;
    try {
      const url = new URL(source.trim());
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (!local && !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(url.hostname)) continue;
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") continue;
      if (url.protocol !== "https:" && !(url.protocol === "http:" && local && !onVercel)) continue;
      if (local && onVercel) continue;
      origins.add(url.origin);
    } catch { /* Invalid environment entries never widen the allowlist. */ }
  }
  return [...origins];
}

export function assertMutationOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const site = request.headers.get("sec-fetch-site");
  assert(site !== "cross-site" && site !== "same-site", "Origem não permitida", 403);
  const origin = request.headers.get("origin");
  if (origin) {
    assert(allowedOrigins().includes(origin) && origin === new URL(request.url).origin, "Origem não permitida", 403);
  } else {
    // Browser mutations provide Origin or Fetch Metadata. Non-browser
    // integrations must provide a bearer token, which Clerk still validates.
    assert(site === "same-origin" || /^Bearer \S+$/i.test(request.headers.get("authorization") || ""), "Origem não permitida", 403);
  }
}

export function publicRateKey(request: Request, scope: string) {
  // Vercel overwrites this header at its trusted edge. Outside Vercel we do
  // not trust arbitrary forwarded headers; the local endpoint shares a bucket.
  const address = process.env.VERCEL === "1"
    ? (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 100)
    : "local";
  return `${scope}:${createHash("sha256").update(address).digest("hex")}`;
}

export async function readBoundedText(request: Request) {
  const length = request.headers.get("content-length");
  if (length !== null) {
    assert(/^\d+$/.test(length), "Tamanho do corpo inválido", 400);
    assert(Number(length) < MAX_REQUEST_BYTES, "Corpo muito grande", 413);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size >= MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => {});
        throw new AppError(413, "Corpo muito grande");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new AppError(400, "Texto inválido"); }
}

export async function readJsonBody(request: Request) {
  assert(/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""), "Envie JSON", 415);
  const raw = await readBoundedText(request);
  try { return JSON.parse(raw); }
  catch { throw new AppError(400, "JSON inválido"); }
}
