import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, NextRequest } from "next/server";
import { allowedOrigins } from "./lib/request-security";
import { contentSecurityPolicy } from "./lib/security-headers";
import { randomBytes } from "node:crypto";
const restricted = (req: NextRequest) =>
  /^\/(cliente|admin)(\/|$)/.test(req.nextUrl.pathname);
const withClerk = clerkMiddleware(async (auth, req) => {
  if (restricted(req)) await auth.protect();
}, () => ({ signInUrl: "/entrar", signUpUrl: "/cadastro", authorizedParties: allowedOrigins() }));
export default async function proxy(
  req: NextRequest,
  event: Parameters<typeof withClerk>[1],
) {
  // Overwrite client-supplied CSP/nonce headers. Next uses this request policy
  // to nonce its streamed scripts; Clerk receives the same trusted nonce.
  const nonce = randomBytes(16).toString("base64");
  const policy = contentSecurityPolicy(process.env, nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const securedRequest = new NextRequest(req, { headers: requestHeaders });
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  let response: Response;
  // Read-only capability links have their own narrow token authorization.
  // They must work without Clerk cookies or a Clerk network dependency.
  if (/^\/(?:acompanhar|api\/tracking)(?:\/|$)/.test(req.nextUrl.pathname)) {
    response = next();
  } else if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  ) {
    response = restricted(req) ? NextResponse.redirect(new URL("/entrar", req.url)) : next();
  } else {
    response = (await withClerk(securedRequest, event)) || next();
  }
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|pdf|zip)).*)",
    "/(api)(.*)",
    "/__clerk/:path*",
  ],
};
