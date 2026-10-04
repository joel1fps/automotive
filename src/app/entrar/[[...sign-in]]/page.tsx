import { AuthScreen } from "@/components/auth-screen";
export const metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AuthScreen />;
}
