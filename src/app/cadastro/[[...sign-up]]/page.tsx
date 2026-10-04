import { AuthScreen } from "@/components/auth-screen";
export const metadata = {
  title: "Cadastro",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AuthScreen signup />;
}
