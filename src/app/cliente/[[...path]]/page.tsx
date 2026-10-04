import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { Dashboard } from "@/components/dashboard";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  const section = path?.join("/") || "";
  if (!["", "agendar", "fidelidade", "historico"].includes(section)) notFound();
  const actor = await requireActor();
  return <Dashboard section={section} name={actor.user.name} />;
}
