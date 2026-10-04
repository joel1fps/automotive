import { notFound } from "next/navigation";
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
  const page = pages[path?.join("/") || ""];
  if (!page) notFound();
  const address = businessContact.address;
  return (
    <>
      {address && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "AutoWash",
              name: "Automotive — Lava a Jato e Serviços",
              url: process.env.NEXT_PUBLIC_SITE_URL,
              telephone: businessContact.whatsapp,
              openingHours: "Mo-Sa 08:00-17:00",
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
