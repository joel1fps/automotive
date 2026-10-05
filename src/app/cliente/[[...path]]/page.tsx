import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard";
import { profileNeedsOnboarding } from "@/lib/profile";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  const section = path?.join("/") || "";
  if (!["", "agendar", "fidelidade", "historico", "perfil"].includes(section)) notFound();
  const actor = await requireActor();
  if (section !== "perfil" && profileNeedsOnboarding(actor)) redirect("/cliente/perfil");
  return <Dashboard section={section} name={actor.user.name} role={actor.role} />;
}
