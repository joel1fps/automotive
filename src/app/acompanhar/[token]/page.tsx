import type { Metadata } from "next";
import { VehicleTracking } from "@/components/vehicle-tracking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Acompanhamento do veículo",
  description: "Acompanhe o andamento do atendimento do seu veículo na Automotive.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: "no-referrer",
  openGraph: null,
  twitter: null,
};

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VehicleTracking token={token} />;
}
