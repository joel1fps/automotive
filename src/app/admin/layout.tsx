import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth";
import { AppError } from "@/lib/domain";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireActor(true);
  } catch (e) {
    if (e instanceof AppError && e.status === 403) redirect("/cliente");
    if (e instanceof AppError && [401, 503].includes(e.status))
      redirect("/entrar");
    throw e;
  }
  return children;
}
