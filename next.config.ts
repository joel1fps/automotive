import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/security-headers";
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { proxyClientMaxBodySize: 300000 },
  serverExternalPackages: ["mongoose", "exceljs"],
  logging: { incomingRequests: { ignore: [/^\/(?:acompanhar|api\/tracking)(?:\/|$)/] } },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      ...["/api/:path*", "/admin/:path*", "/cliente/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      })),
      ...["/acompanhar/:path*", "/api/tracking/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      })),
    ];
  },
};
export default config;
