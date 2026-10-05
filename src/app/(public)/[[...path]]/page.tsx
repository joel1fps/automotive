import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { PublicSite } from "@/components/public-site";
import { businessContact } from "@/lib/site-config";
const pages: Record<string, string> = {
  "": "home",
  servicos: "servicos",
  galeria: "galeria",
  contato: "contato",
  privacidade: "privacidade",
};
export async function generateMetadata({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  const key = path?.join("/") || "";
  if (!Object.hasOwn(pages, key)) notFound();
  return {
    title: key
      ? (
          {
            servicos: "Serviços e preços",
            galeria: "Antes e depois",
            contato: "Contato",
            privacidade: "Privacidade",
          } as Record<string, string>
        )[key]
      : "Automotive — Lava a Jato e Serviços",
    alternates: { canonical: `/${key}` },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  const key = path?.join("/") || "";
  if (!Object.hasOwn(pages, key)) notFound();
  const page = pages[key];
  const address = businessContact.address;
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <>
      {address && (
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "AutoWash",
              name: "Automotive — Lava a Jato e Serviços",
              url: process.env.NEXT_PUBLIC_SITE_URL,
              telephone: businessContact.whatsapp,
              sameAs: [businessContact.instagram],
              address: {
                "@type": "PostalAddress",
                streetAddress: address,
                addressCountry: "BR",
              },
            }).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <PublicSite page={page} />
    </>
  );
}
