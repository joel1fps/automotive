"use client";

import { useEffect, useRef, useState } from "react";
import { api, appointmentClient, displayDate, useResource, type AppointmentItem } from "@/lib/client-api";
import type { AdminTrackingInfo } from "@/lib/tracking";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import styles from "./tracking-admin.module.css";
import { DateTimePicker } from "./ui/date-time-picker";
import { localDateTimeParts, localDateTimeToIso } from "@/lib/local-date-time";

export function TrackingDetails({ appointment, disabled = false }: { appointment: AppointmentItem; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const endpoint = `/api/admin/appointments/${appointment._id}/tracking`;
  const resource = useResource<AdminTrackingInfo>(open ? endpoint : null, { pollMs: 10000 });
  const info = resource.data;
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"regenerate" | "revoke" | null>(null);
  const [estimateDate, setEstimateDate] = useState("");
  const [estimateTime, setEstimateTime] = useState("");
  const linkInput = useRef<HTMLInputElement>(null);
  const customer = appointmentClient(appointment);
  const finished = ["ready", "completed", "delivered", "returned", "cancelled", "rejected"].includes(appointment.status);
  const estimateRequired = appointment.flexibleSchedule && appointment.status === "confirmed";
  const publicLink = info?.url && typeof window !== "undefined" ? new URL(info.url, window.location.origin).href : "";

  useEffect(() => {
    const parts = localDateTimeParts(info?.estimatedCompletionAt);
    setEstimateDate(parts.date); setEstimateTime(parts.time);
  }, [info?.estimatedCompletionAt]);

  async function mutate(method: "POST" | "DELETE" | "PATCH", input?: object) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await api<AdminTrackingInfo>(endpoint, { method, ...(input ? { body: JSON.stringify(input) } : {}) });
      resource.refresh();
      setConfirmation(null);
      setMessage(method === "DELETE" ? "Link revogado. Ele não permite mais acompanhar este atendimento."
        : method === "PATCH" ? "Previsão atualizada para o cliente."
        : "Link disponível. Copie e envie ao cliente.");
    } catch (failure) { setError((failure as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }

  async function copy() {
    setMessage(""); setError("");
    try { await navigator.clipboard.writeText(publicLink); setMessage("Link copiado."); }
    catch { linkInput.current?.focus(); linkInput.current?.select(); setMessage("Selecione e copie o endereço do campo abaixo."); }
  }

  return <>
    <Button type="button" variant="secondary" disabled={disabled} onClick={() => {
      setError(""); setMessage(""); setConfirmation(null); setOpen(true);
    }}>Detalhes / acompanhamento</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }} title="Detalhes do atendimento">
      <div className={styles.details}>
        <h3>{appointment.vehicle.plate} · {appointment.vehicle.model}</h3>
        <p>{customer.name} · {appointment.serviceName}</p>
        <dl className={styles.dates}>
          <div><dt>Agendamento</dt><dd>{appointment.walkIn ? "Entrada sem agendamento" : displayDate(appointment.scheduledAt)}</dd></div>
          <div><dt>Entrada do veículo</dt><dd>{appointment.arrivedAt ? displayDate(appointment.arrivedAt) : "Ainda não registrada"}</dd></div>
          <div><dt>Serviço concluído</dt><dd>{appointment.readyAt ? displayDate(appointment.readyAt) : "Ainda não registrado"}</dd></div>
          <div><dt>Saída do veículo</dt><dd>{appointment.returnedAt ? `${displayDate(appointment.returnedAt)} · devolução` : appointment.deliveredAt ? displayDate(appointment.deliveredAt) : "Ainda não entregue"}</dd></div>
        </dl>
      </div>
      <section className={styles.section} aria-label="Acompanhamento do cliente" aria-busy={busy || resource.loading}>
        <h3>Acompanhamento do cliente</h3>
        <p>Quem receber o link poderá ver apenas este veículo, serviço e andamento, sem criar conta.</p>
        {resource.loading && !info && <p role="status">Carregando acompanhamento…</p>}
        {resource.error && <><p className="alert-error" role="alert">{resource.error}</p><Button type="button" variant="secondary" onClick={resource.refresh}>Tentar novamente</Button></>}
        {info && <>
          {info.active && publicLink ? <>
            <label className={styles.link}>Link de acompanhamento<input ref={linkInput} readOnly value={publicLink} autoComplete="off" onFocus={(event) => event.currentTarget.select()} /></label>
            <div className={styles.actions}>
              <Button type="button" disabled={busy} onClick={copy}>Copiar link</Button>
              <a className="button secondary" href={publicLink} target="_blank" rel="noreferrer">Visualizar acompanhamento</a>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => { setConfirmation("regenerate"); setError(""); setMessage(""); }}>Gerar novamente</Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => { setConfirmation("revoke"); setError(""); setMessage(""); }}>Revogar link</Button>
            </div>
          </> : <>
            <p>{info.revokedAt ? "O link anterior foi revogado." : "Nenhum link de acompanhamento gerado."}</p>
            <Button type="button" disabled={busy} onClick={() => mutate("POST", { action: "generate" })}>{busy ? "Gerando…" : "Gerar link de acompanhamento"}</Button>
          </>}
          {confirmation && <div className="notice">
            <p>{confirmation === "revoke" ? "O link atual deixará de funcionar. Você poderá gerar outro depois." : "O link atual deixará de funcionar e será substituído. Envie o novo endereço ao cliente."}</p>
            <div className={styles.actions}>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Voltar</Button>
              <Button type="button" variant={confirmation === "revoke" ? "danger" : "primary"} disabled={busy}
                onClick={() => confirmation === "revoke" ? mutate("DELETE") : mutate("POST", { action: "regenerate" })}>
                {busy ? "Salvando…" : confirmation === "revoke" ? "Confirmar revogação" : "Confirmar novo link"}
              </Button>
            </div>
          </div>}
          <form className={styles.estimate} onSubmit={(event) => {
            event.preventDefault();
            const parsed = localDateTimeToIso(estimateDate, estimateTime);
            if ((estimateDate || estimateTime || estimateRequired) && !parsed) { setError("Informe uma data e horário válidos para a previsão."); return; }
            mutate("PATCH", { estimatedCompletionAt: parsed || null });
          }}>
            <div className="form-grid"><DateTimePicker date={estimateDate} time={estimateTime}
              onDateChange={setEstimateDate} onTimeChange={setEstimateTime}
              dateLabel="Data prevista de entrega" timeLabel="Hora prevista de entrega"
              disabled={busy || finished} required={!!estimateRequired} /></div>
            <small>Horário de Fortaleza. A previsão aparece no acompanhamento do cliente.</small>
            {!finished && <div className={styles.actions}>
              <Button type="submit" variant="secondary" disabled={busy}>Salvar previsão</Button>
              {info.estimatedCompletionAt && !estimateRequired && <Button type="button" variant="secondary" disabled={busy} onClick={() => mutate("PATCH", { estimatedCompletionAt: null })}>Remover previsão</Button>}
            </div>}
            {finished && <small>Este atendimento já chegou a uma etapa final; novas previsões não são necessárias.</small>}
          </form>
        </>}
        {error && <p className="alert-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </section>
    </Dialog>
  </>;
}
