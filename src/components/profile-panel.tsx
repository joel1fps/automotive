"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useResource } from "@/lib/client-api";
import { phoneSchema, profileSchema, type OwnProfile } from "@/lib/profile";
import { Button } from "./ui/button";

export function ProfilePanel() {
  const resource = useResource<OwnProfile>("/api/profile/me");
  const router = useRouter();
  const initialized = useRef(false);
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});

  useEffect(() => {
    if (!resource.data || initialized.current) return;
    initialized.current = true;
    // A Clerk fallback is a display label, not a completed name field.
    setName(resource.data.name === "Cliente" || resource.data.name.includes("@") ? "" : resource.data.name);
    const normalized = phoneSchema.safeParse(resource.data.phone);
    setPhone(normalized.success ? `+${normalized.data}` : resource.data.phone);
  }, [resource.data]);

  if (resource.loading && !resource.data) return <div className="skeleton" aria-label="Carregando perfil" />;
  if (resource.error) return <p className="alert-error" role="alert">{resource.error}</p>;
  const incomplete = !resource.data?.complete;
  const optionalAdminProfile = resource.data?.role === "admin";
  const destination = resource.data?.role === "admin" ? "/admin" : "/cliente";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    setSaved(false);
    const parsed = profileSchema.safeParse({ name, phone });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setFieldErrors({ name: fields.name?.[0], phone: fields.phone?.[0] });
      return;
    }
    setFieldErrors({});
    submitting.current = true;
    setSaving(true);
    try {
      const updated = await api<OwnProfile>("/api/profile/me", { method: "PATCH", body: JSON.stringify(parsed.data) });
      setName(updated.name);
      setPhone(`+${updated.phone}`);
      setSaved(true);
      resource.refresh();
      router.refresh();
      if (incomplete) router.push(destination);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 760 }} aria-labelledby="profile-heading">
      <h2 id="profile-heading">{incomplete && !optionalAdminProfile ? "Complete seu cadastro" : "Meu perfil"}</h2>
      <p style={{ margin: "14px 0 24px" }}>
        {optionalAdminProfile ? "Seu perfil pessoal é opcional para administrar o lava-jato. Para salvá-lo, informe seu nome completo e telefone com DDD." : incomplete ? "Informe seu nome completo e telefone com DDD para solicitar um agendamento e receber informações sobre seu veículo." : "Mantenha seus dados atualizados para facilitar o atendimento e os avisos sobre seu veículo."}
      </p>
      <form onSubmit={save} className="form-grid" aria-busy={saving}>
        <label className="full" htmlFor="profile-name">
          Nome completo
          <input id="profile-name" name="name" autoComplete="name" required maxLength={120} value={name}
            onChange={(event) => { setName(event.target.value); setSaved(false); }}
            aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? "profile-name-error" : undefined} />
          {fieldErrors.name && <span className="alert-error" id="profile-name-error" role="alert">{fieldErrors.name}</span>}
        </label>
        <label className="full" htmlFor="profile-phone">
          Telefone / WhatsApp com DDD
          <input id="profile-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" required maxLength={30}
            placeholder="(85) 99912-3456" value={phone}
            onChange={(event) => { setPhone(event.target.value); setSaved(false); }}
            aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? "profile-phone-error" : "profile-phone-help"} />
          <span className="fine-print" id="profile-phone-help">Pode usar parênteses, espaços e o código +55.</span>
          {fieldErrors.phone && <span className="alert-error" id="profile-phone-error" role="alert">{fieldErrors.phone}</span>}
        </label>
        <div className="full">
          <p className="fine-print">E-mail da sua conta</p>
          <p style={{ overflowWrap: "anywhere" }}>{resource.data?.email || "Gerenciado pela sua conta Clerk"}</p>
          <p className="fine-print">O e-mail e o acesso à conta são gerenciados pelo login.</p>
        </div>
        {error && <p className="alert-error full" role="alert">{error}</p>}
        {saved && <p className="alert-success full" role="status">Perfil atualizado.</p>}
        <div className="full" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Button type="submit" disabled={saving}>{saving ? "Salvando…" : incomplete ? "Salvar e continuar" : "Salvar alterações"}</Button>
          {(!incomplete || resource.data?.role === "admin") && <Link className="button secondary" href={destination}>Voltar ao painel</Link>}
        </div>
      </form>
    </section>
  );
}
