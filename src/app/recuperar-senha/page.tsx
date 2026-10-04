import { PasswordRecovery } from "@/components/password-recovery";

export const metadata = { title: "Recuperar senha", robots: { index: false, follow: false } };

export default function Page() {
  return <PasswordRecovery />;
}
