import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
const restricted = (req: NextRequest) =>
  /^\/(cliente|admin)(\/|$)/.test(req.nextUrl.pathname);
const withClerk = clerkMiddleware(async (auth, req) => {
  if (restricted(req)) await auth.protect();
}, { signInUrl: "/entrar", signUpUrl: "/cadastro" });
export default function proxy(
  req: NextRequest,
  event: Parameters<typeof withClerk>[1],
) {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  ) {
    if (restricted(req))
      return NextResponse.redirect(new URL("/entrar", req.url));
    return NextResponse.next();
  }
  return withClerk(req, event);
}
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|pdf|zip)).*)",
    "/(api)(.*)",
  ],
};
