"use client";
import { ClerkProvider } from "@clerk/nextjs";
import { ptBR } from "@clerk/localizations";
export function ClerkConfiguredProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <ClerkProvider
      nonce={nonce}
      localization={ptBR}
      signInUrl="/entrar"
      signUpUrl="/cadastro"
      signInFallbackRedirectUrl="/cliente"
      signUpFallbackRedirectUrl="/cliente"
      appearance={{
        variables: {
          colorPrimary: "#1f4fc4",
          colorBackground: "#101b27",
          colorForeground: "#ffffff",
          colorInput: "#071421",
          colorInputForeground: "#ffffff",
          borderRadius: "0.75rem",
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
