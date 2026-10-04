import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/servicos", "/galeria", "/contato", "/privacidade"].map(
    (path) => ({
      url: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}${path}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
    }),
  );
}
