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
  if (
    ![
      "",
      "controle",
      "agendamentos",
      "clientes",
      "servicos",
      "financeiro",
      "cupons",
      "logs",
      "configuracoes",
    ].includes(section)
  )
    notFound();
  const actor = await requireActor(true);
  return <Dashboard admin section={section} name={actor.user.name} />;
}
