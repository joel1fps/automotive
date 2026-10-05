"use client";
import { useRef, useState } from "react";
import { api, appointmentClient, dateNow, displayDate, useResource, type ClientItem, type Paged, type AppointmentItem } from "@/lib/client-api";
import { localDateTimeParts, localDateTimeToIso } from "@/lib/local-date-time";
import { appointmentTransitions, nextOperationalAction } from "@/lib/appointment-state";
import { vehicleLabels } from "@/lib/catalog";
import { phoneSchema } from "@/lib/profile";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { TrackingDetails } from "./tracking-admin";
import { DeleteAppointmentAction } from "./appointment-delete";
import { DatePicker } from "./ui/date-picker";
import { DateTimePicker } from "./ui/date-time-picker";
import { createRequestIdentity } from "@/lib/client-request";

export function ServiceActions({ id, refresh }: { id: string; refresh: () => void }) {
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function run(reset:boolean) {
    if (!confirm(reset ? "Restaurar nome, descrição, preços e imagem padrão deste serviço?" : "Excluir do catálogo ativo? O histórico será preservado e você poderá reativar em Editar.")) return;
    setBusy(true);setError("");
    try {await api(`/api/admin/services/${id}${reset ? "/reset" : ""}`,{method:reset?"POST":"DELETE",body:reset?"{}":undefined});refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><Button variant="secondary" disabled={busy} onClick={()=>run(true)}>Restaurar padrão</Button><Button variant="danger" disabled={busy} onClick={()=>run(false)}>Excluir do catálogo</Button>{error && <p role="alert">{error}</p>}</>;
}

export function OperationalActions({ appointment: a, refresh }: { appointment: AppointmentItem; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [dialogAction, setDialogAction] = useState("");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [payment, setPayment] = useState("pix");
  const [newDate, setNewDate] = useState(dateNow());
  const [newTime, setNewTime] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(dateNow());
  const [deliveryTime, setDeliveryTime] = useState("");
  const next = nextOperationalAction(a.status);
  const contact = appointmentClient(a);
  const validPhone = phoneSchema.safeParse(contact.phone).success;
  const customerEmail = a.userId && typeof a.userId === "object" ? a.userId.email : "";
  const titles: Record<string, string> = { confirm: "Aprovar agendamento", complete: "Registrar pagamento e concluir", reject: "Recusar solicitação", cancel: "Cancelar agendamento", reschedule: "Reagendar", return: "Registrar devolução sem conclusão" };
  function open(action: string) {
    setDialogAction(action); setReason(""); setError(""); setMessage("");
    setValue(a.quotedPrice == null ? "" : String(a.quotedPrice));
    const scheduled = localDateTimeParts(a.scheduledAt);
    const estimate = localDateTimeParts(a.estimatedCompletionAt);
    setPayment("pix"); setNewDate(scheduled.date || dateNow()); setNewTime(scheduled.time);
    setDeliveryDate(estimate.date || (scheduled.date > dateNow() ? scheduled.date : dateNow()));
    setDeliveryTime(estimate.time);
  }
  async function run(body: object, channel?: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setMessage(""); setUrl("");
    try {
      const result = await api<{ url?: string }>(`/api/admin/appointments/${a._id}${channel ? "/notify" : ""}`, {
        method: channel ? "POST" : "PATCH", body: JSON.stringify(channel ? { channel } : body),
      });
      if (result.url) setUrl(result.url);
      else setMessage(channel ? "E-mail aceito para envio." : "Etapa atualizada.");
      setDialogAction(""); refresh();
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  return <>
    <div className="row-actions" aria-busy={busy}>
      <TrackingDetails appointment={a} disabled={busy} />
      <DeleteAppointmentAction appointment={a} refresh={refresh} disabled={busy} onBusyChange={setBusy} />
      {next && next !== "complete" && <Button disabled={busy} type="button" onClick={() => run({ action: next })}>{appointmentTransitions[next].label}</Button>}
      {a.status === "pending" && <Button disabled={busy} type="button" onClick={() => open("confirm")}>{appointmentTransitions.confirm.label}</Button>}
      {a.status === "ready" && <Button disabled={busy} type="button" onClick={() => open("complete")}>Registrar pagamento / concluir</Button>}
      {["arrived", "in_progress", "ready"].includes(a.status) && <Button disabled={busy} type="button" variant="secondary" onClick={() => open("return")}>Registrar devolução sem conclusão</Button>}
      {a.status === "pending" && <Button disabled={busy} type="button" variant="danger" onClick={() => open("reject")}>Recusar</Button>}
      {["pending", "confirmed"].includes(a.status) && <>
        <Button disabled={busy} type="button" variant="secondary" onClick={() => open("reschedule")}>Reagendar</Button>
        <Button disabled={busy} type="button" variant="secondary" onClick={() => open("cancel")}>Cancelar</Button>
      </>}
      {["in_progress", "ready", "completed"].includes(a.status) && <>
        {customerEmail && <Button variant="secondary" disabled={busy} type="button" onClick={() => run({}, "email")}>Enviar aviso por e-mail</Button>}
        <Button variant="secondary" disabled={busy || !validPhone} title={validPhone ? undefined : "Informe um telefone válido do cliente para preparar o aviso"} type="button" onClick={() => run({}, "whatsapp")}>Preparar WhatsApp</Button>
      </>}
      {url && <a className="button secondary" href={url} target="_blank" rel="noreferrer">Abrir mensagem no WhatsApp</a>}
      {!dialogAction && error && <p className="alert-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
    <Dialog open={!!dialogAction} onOpenChange={(open) => { if (!open && !busy) setDialogAction(""); }} title={titles[dialogAction] || "Atendimento"}>
      <p>{a.serviceName} · {a.vehicle.plate}</p>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (dialogAction === "return" && reason.trim().length < 5) {
          setError("Descreva o motivo da devolução com pelo menos 5 caracteres."); return;
        }
        const scheduledAt = dialogAction === "reschedule" ? localDateTimeToIso(newDate, newTime) : a.scheduledAt;
        const needsEstimate = dialogAction === "confirm" || (dialogAction === "reschedule" && a.status === "confirmed");
        const estimatedCompletionAt = needsEstimate ? localDateTimeToIso(deliveryDate, deliveryTime) : "";
        if (dialogAction === "reschedule" && (!scheduledAt || +new Date(scheduledAt) <= Date.now())) {
          setError("Escolha uma data e horário futuros para o reagendamento."); return;
        }
        if (needsEstimate && (!estimatedCompletionAt || +new Date(estimatedCompletionAt) <= Date.now() || +new Date(estimatedCompletionAt) < +new Date(scheduledAt))) {
          setError("Informe uma previsão de entrega futura, igual ou posterior ao horário do agendamento."); return;
        }
        run({ action: dialogAction, ...(dialogAction === "complete" ? { finalPrice: a.couponId ? 0 : Number(value), paymentMethod: payment }
          : dialogAction === "confirm" ? { estimatedCompletionAt }
          : dialogAction === "reschedule" ? { scheduledAt, ...(estimatedCompletionAt ? { estimatedCompletionAt } : {}) } : { reason: reason.trim() }) });
      }}>
        {dialogAction === "confirm" ? <>
          <p className="notice">Horário solicitado: {displayDate(a.scheduledAt)}. Defina a previsão de entrega para confirmar o atendimento. Ela aparecerá para o cliente e poderá ser atualizada depois.</p>
          <div className="form-grid"><DateTimePicker date={deliveryDate} time={deliveryTime} dateLabel="Data prevista de entrega" timeLabel="Horário previsto de entrega"
            minDate={localDateTimeParts(a.scheduledAt).date > dateNow() ? localDateTimeParts(a.scheduledAt).date : dateNow()} required disabled={busy} onDateChange={setDeliveryDate} onTimeChange={setDeliveryTime} /></div>
        </> : dialogAction === "complete" ? <>
          <p className="notice">O serviço está pronto. Registre o valor recebido para lançar a receita no financeiro; depois registre a entrega do veículo.</p>
          <div className="form-grid">
            <label>Valor final (R$)<input type="number" required min="0" max="1000000" step="0.01" value={a.couponId ? "0" : value} disabled={!!a.couponId || busy} onChange={(e) => setValue(e.target.value)} /></label>
            <label>Pagamento<select value={payment} disabled={busy} onChange={(e) => setPayment(e.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option></select></label>
            {a.couponId && <p className="full notice">Cortesia: valor zero, sem pontos de fidelidade.</p>}
          </div>
        </> : dialogAction === "reschedule" ? <div className="form-grid">
          <DateTimePicker date={newDate} time={newTime} dateLabel="Nova data" timeLabel="Novo horário desejado" minDate={dateNow()} required disabled={busy} onDateChange={setNewDate} onTimeChange={setNewTime} />
          <p className="full fine-print">Horário livre, no fuso de Fortaleza. Solicitações pendentes continuam aguardando aprovação.</p>
          {a.status === "confirmed" && <><DateTimePicker date={deliveryDate} time={deliveryTime} dateLabel="Data prevista de entrega" timeLabel="Horário previsto de entrega"
            minDate={newDate} required disabled={busy} onDateChange={setDeliveryDate} onTimeChange={setDeliveryTime} /><p className="full fine-print">Atualize a previsão de entrega junto com o novo horário confirmado.</p></>}
        </div> : dialogAction === "return" ? <>
          <p className="notice">Confirme que o veículo está sendo devolvido ao cliente. O atendimento sairá da fila física e ficará no histórico com a data e o motivo da devolução. Esta ação não registra pagamento.</p>
          {a.readyAt && <p className="fine-print">O registro de conclusão já existente será preservado. Explique no motivo por que o atendimento está sendo encerrado sem pagamento.</p>}
          <label>Motivo da devolução<textarea required minLength={5} maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente retirou o veículo antes da execução do serviço" /></label>
          <p className="fine-print">Seu usuário, a data e o motivo ficarão registrados em Logs.</p>
        </> : <label>Motivo (opcional)<textarea maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} /></label>}
        {error && <p className="alert-error" role="alert">{error}</p>}
        <div className="form-actions"><Button variant="secondary" type="button" disabled={busy} onClick={() => setDialogAction("")}>Voltar</Button><Button disabled={busy || (dialogAction === "return" && reason.trim().length < 5)} type="submit">{busy ? "Salvando…" : dialogAction === "confirm" ? "Aprovar agendamento" : dialogAction === "return" ? "Confirmar devolução" : "Confirmar ação"}</Button></div>
      </form>
    </Dialog>
  </>;
}

export function RoleActions({ client, refresh }: { client:ClientItem; refresh:()=>void }) {
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  async function change(role:string){
    if(!confirm(`${role === "admin" ? "Conceder" : "Remover"} acesso administrativo de ${client.email}?`))return;
    setBusy(true);setMessage("");
    try{await api(`/api/admin/clients/${client._id}/role`,{method:"PATCH",body:JSON.stringify({role})});setMessage("Permissão atualizada.");refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="notice"><p>Acesso atual: {client.role === "admin" ? "Administrador" : "Cliente"}</p><Button disabled={busy} onClick={()=>change(client.role === "admin" ? "client":"admin")}>{client.role === "admin" ? "Remover administrador" : "Tornar administrador"}</Button>{message && <p role="status">{message}</p>}</div>;
}

export function CouponIssuer({refresh}:{refresh:()=>void}) {
  const [query,setQuery]=useState("");const {data}=useResource<Paged<ClientItem>>(`/api/admin/clients?search=${encodeURIComponent(query)}`);
  const [expires, setExpires] = useState("");
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  const requestIdentity=useRef(createRequestIdentity());
  const locked=useRef(false);
  return <details className="notice"><summary>Criar cupom de lavagem grátis</summary><p>Cortesia para Lavagem Simples, vinculada ao cliente e veículo.</p><form onSubmit={async e=>{e.preventDefault();if(locked.current)return;const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));locked.current=true;setBusy(true);setMessage("");try{const input={userId:values.userId,vehicle:{model:values.model,plate:values.plate,type:values.type},expiresAt:new Date(`${values.expires}T23:59:59-03:00`).toISOString(),reason:values.reason};await api("/api/admin/coupons",{method:"POST",body:JSON.stringify({...input,requestId:requestIdentity.current.get(input)})});requestIdentity.current.reset();setMessage("Cupom criado.");form.reset();setExpires("");refresh();}catch(err){setMessage((err as Error).message);}finally{locked.current=false;setBusy(false);}}}>
    <div className="form-grid"><label>Buscar cliente<input value={query} onChange={e=>setQuery(e.target.value)} /></label><label>Cliente<select name="userId" required><option value="">Selecione</option>{data?.items.map(c=><option value={c._id} key={c._id}>{c.name} — {c.email}</option>)}</select></label><label>Modelo<input name="model" required minLength={2}/></label><label>Placa<input name="plate" required/></label><label>Tipo<select name="type">{Object.entries(vehicleLabels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label>Validade<DatePicker ariaLabel="Validade" name="expires" min={dateNow()} required value={expires} onChange={setExpires} disabled={busy}/></label><label>Motivo<input name="reason" minLength={5} maxLength={500} required/></label></div><Button disabled={busy}>Criar cupom</Button>{message && <p role="status">{message}</p>}
  </form></details>;
}
