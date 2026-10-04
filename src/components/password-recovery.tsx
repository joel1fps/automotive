"use client";

import { useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./public-site";

export function PasswordRecovery() {
  return <main className="auth-page"><Brand /><section className="auth-box recovery-box">
    <h1>Recuperar senha</h1>
    {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <RecoveryForm /> : <p>A recuperação está indisponível no momento. Tente novamente mais tarde.</p>}
  </section><Link className="text-link" style={{ marginTop: 28 }} href="/entrar">Voltar para entrar</Link></main>;
}

function RecoveryForm() {
  const { signIn, fetchStatus } = useSignIn();
  const [step, setStep] = useState<"email" | "code" | "password" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [step]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const disabled = busy || fetchStatus === "fetching";

  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); }
    catch { setError("Não foi possível concluir. Confira os dados e sua conexão e tente novamente."); }
    finally { lock.current = false; setBusy(false); }
  }

  async function send() {
    const created = await signIn.create({ identifier: email.trim() });
    if (created.error) { setError("Não foi possível enviar o código. Confira o e-mail ou use a opção Continuar com Google na tela de entrada."); return; }
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) { setError("Não foi possível enviar o código agora. Aguarde e tente novamente. Se usa Google, entre com Google."); return; }
    setCode(""); setStep("code"); setCooldown(60);
  }

  if (step === "done") return <div role="status"><p>Senha alterada com sucesso. Entre novamente com sua nova senha.</p><Link className="button primary" href="/entrar">Entrar na minha conta</Link></div>;

  return <form aria-busy={disabled} onSubmit={event => {
    event.preventDefault();
    void perform(async () => {
      if (step === "email") return send();
      if (step === "code") {
        const result = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
        if (result.error) { setError("Código inválido ou expirado. Confira o e-mail ou solicite um novo código."); return; }
        setCode(""); setStep("password"); return;
      }
      if (password !== confirmation) { setError("As senhas não coincidem."); return; }
      const result = await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });
      if (result.error) { setError("Não foi possível salvar. Use uma senha mais forte, com pelo menos 8 caracteres, e diferente de senhas expostas em vazamentos."); return; }
      // Start a fresh native sign-in so Clerk handles MFA and any session tasks.
      setPassword(""); setConfirmation(""); setStep("done");
      await signIn.reset();
    });
  }}>
    {step === "email" && <><p>Informe seu e-mail para receber um código de recuperação.</p><label htmlFor="recovery-email">Seu e-mail</label><input ref={input} id="recovery-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={disabled} /><p className="recovery-hint">Se você entra com Google, continue usando esse botão na tela de entrada.</p></>}
    {step === "code" && <><p>Confira sua caixa de entrada e o spam. Digite o código enviado por e-mail.</p><label htmlFor="recovery-code">Código de recuperação</label><input ref={input} id="recovery-code" autoComplete="one-time-code" inputMode="numeric" required value={code} onChange={e => setCode(e.target.value)} disabled={disabled} /></>}
    {step === "password" && <><p>Escolha uma nova senha. As outras sessões serão desconectadas.</p><label htmlFor="recovery-password">Nova senha</label><input ref={input} id="recovery-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} disabled={disabled} /><label htmlFor="recovery-confirmation">Confirmar nova senha</label><input id="recovery-confirmation" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={disabled} /></>}
    {error && <p className="recovery-error" role="alert">{error}</p>}
    <button className="button primary" type="submit" disabled={disabled}>{disabled ? "Aguarde…" : step === "email" ? "Enviar código" : step === "code" ? "Verificar código" : "Salvar nova senha"}</button>
    {step === "code" && <><button className="text-link recovery-secondary" type="button" disabled={disabled || cooldown > 0} onClick={() => void perform(send)}>{cooldown ? `Reenviar em ${cooldown}s` : "Reenviar código"}</button><button className="text-link recovery-secondary" type="button" disabled={disabled} onClick={() => { setError(""); setCode(""); setStep("email"); }}>Usar outro e-mail</button></>}
  </form>;
}
