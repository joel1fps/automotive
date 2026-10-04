// Dados registrados em ATUALIZACAO-MIDIAS.md. Variáveis públicas permitem atualização.
export const businessContact = {
  address: process.env.NEXT_PUBLIC_ADDRESS || "Rua Coronel Costa Araújo, 1565, Fátima, Teresina - PI (atrás do hospital São Paulo)",
  whatsapp: (process.env.NEXT_PUBLIC_WHATSAPP || "5586998469155").replace(/\D/g, ""),
  instagram: process.env.NEXT_PUBLIC_INSTAGRAM || "https://www.instagram.com/automotive_the/",
  hours: "Segunda a sábado, das 8h às 17h",
};
export const locationUrl = process.env.NEXT_PUBLIC_MAP_URL || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(businessContact.address)}`;
export const whatsappUrl = (message?: string) => `https://wa.me/${businessContact.whatsapp}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
