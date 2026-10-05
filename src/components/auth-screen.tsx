"use client";
import dynamic from "next/dynamic";
const SignIn=dynamic(()=>import("@clerk/nextjs").then(m=>m.SignIn));
const SignUp=dynamic(()=>import("@clerk/nextjs").then(m=>m.SignUp));
import Link from "next/link";
import { useState } from "react";
import { Brand } from "./brand";
import { whatsappUrl } from "@/lib/site-config";
export function AuthScreen({ signup = false }: { signup?: boolean }) {
  const [consent, setConsent] = useState(false);
  const ready = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return (
    <main className="auth-page">
      <Brand />
      {!ready ? (
        <div className="auth-box">
          <h1>Login indisponível no momento.</h1>
          <p>
            Enquanto o acesso à conta é restabelecido, você pode combinar seu horário pelo WhatsApp.
          </p>
          <a href={whatsappUrl("Olá! Gostaria de agendar um serviço na Automotive.")} className="button primary" target="_blank" rel="noreferrer">Agendar pelo WhatsApp</a>
          <Link href="/servicos" className="button primary">
            Ver serviços e preços
          </Link>
        </div>
      ) : signup && !consent ? (
        <div className="auth-box">
          <h1>Seu cuidado começa aqui.</h1>
          <p>
            Crie sua conta para solicitar agendamentos e acompanhar sua
            fidelidade.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Li a <Link href="/privacidade">política de privacidade</Link> e
              estou ciente do uso dos dados para cadastro e agendamentos.
            </span>
          </label>
          <Link className="text-link" href="/entrar">
            Já tenho uma conta
          </Link>
        </div>
      ) : signup ? (
        <SignUp
          routing="path"
          path="/cadastro"
          unsafeMetadata={{ privacyAcceptedAt: new Date().toISOString() }}
        />
      ) : (
        <>
          <SignIn routing="path" path="/entrar" />
          <Link className="text-link" style={{ marginTop: 20 }} href="/recuperar-senha">Esqueceu a senha?</Link>
        </>
      )}
      <Link className="text-link" style={{ marginTop: 28 }} href="/">
        Voltar ao site
      </Link>
    </main>
  );
}
