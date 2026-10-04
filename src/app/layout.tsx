import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { Loader } from "@/components/fx";
import "./globals.css";
const headingFont = localFont({
  src: "../../node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2",
  variable: "--font-heading",
  display: "swap",
});
const bodyFont = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2",
      weight: "400",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2",
      weight: "500",
    },
    {
      path: "../../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2",
      weight: "600",
    },
  ],
  variable: "--font-body",
  display: "swap",
});
const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: "Automotive — Lava a Jato e Serviços",
    template: "%s | Automotive",
  },
  description:
    "Lavagem e estética automotiva. Conheça os serviços, consulte os preços e solicite seu agendamento na Automotive.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Automotive — Lava a Jato e Serviços",
    description: "Cuidado com cada detalhe do seu veículo.",
    locale: "pt_BR",
    type: "website",
    images: [{ url: "/brand/hero.webp", alt: "Automotive — Lava a Jato e Serviços" }],
  },
  robots: { index: true, follow: true },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      data-scroll-behavior="smooth"
      className={`${headingFont.variable} ${bodyFont.variable}`}
    >
      <body>
        <Providers>
          <Loader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
