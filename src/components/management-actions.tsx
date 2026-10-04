"use client";
import { useState } from "react";
import { api, useResource, type ClientItem, type Paged, type AppointmentItem } from "@/lib/client-api";
import { vehicleLabels } from "@/lib/catalog";
import { Button } from "./ui/button";

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

export function OperationalActions({ appointment:a, refresh }: { appointment:AppointmentItem; refresh:()=>void }) {
  const [busy,setBusy]=useState(false); const [message,setMessage]=useState(""); const [url,setUrl]=useState("");
  const next: Record<string,[string,string]>={confirmed:["arrive","Registrar chegada"],arrived:["start","Iniciar serviço"],in_progress:["ready","Pronto para retirada"],completed:["deliver","Registrar entrega"]};
  async function run(action?:string,channel?:string){
    setBusy(true);setMessage("");setUrl("");
    try {const result=await api<{url?:string}>(`/api/admin/appointments/${a._id}${channel?"/notify":""}`,{method:channel?"POST":"PATCH",body:JSON.stringify(channel?{channel}:{action})});
      if(result.url)setUrl(result.url);else setMessage(channel?"E-mail aceito para envio.":"Etapa atualizada.");refresh();
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="row-actions">{next[a.status] && <Button disabled={busy} onClick={()=>run(next[a.status][0])}>{next[a.status][1]}</Button>}
    {["in_progress","ready","completed"].includes(a.status) && <><Button variant="secondary" disabled={busy} onClick={()=>run(undefined,"email")}>Enviar aviso por e-mail</Button><Button variant="secondary" disabled={busy} onClick={()=>run(undefined,"whatsapp")}>Preparar WhatsApp</Button></>}
    {url && <a className="button secondary" href={url} target="_blank" rel="noreferrer">Abrir mensagem no WhatsApp</a>}{message && <p role="status">{message}</p>}
  </div>;
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
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  return <details className="notice"><summary>Criar cupom de lavagem grátis</summary><p>Cortesia para Lavagem Simples, vinculada ao cliente e veículo.</p><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const values=Object.fromEntries(new FormData(form));setBusy(true);setMessage("");try{await api("/api/admin/coupons",{method:"POST",body:JSON.stringify({userId:values.userId,vehicle:{model:values.model,plate:values.plate,type:values.type},expiresAt:new Date(`${values.expires}T23:59:59-03:00`).toISOString(),reason:values.reason})});setMessage("Cupom criado.");form.reset();refresh();}catch(err){setMessage((err as Error).message);}finally{setBusy(false);}}}>
    <div className="form-grid"><label>Buscar cliente<input value={query} onChange={e=>setQuery(e.target.value)} /></label><label>Cliente<select name="userId" required><option value="">Selecione</option>{data?.items.map(c=><option value={c._id} key={c._id}>{c.name} — {c.email}</option>)}</select></label><label>Modelo<input name="model" required minLength={2}/></label><label>Placa<input name="plate" required/></label><label>Tipo<select name="type">{Object.entries(vehicleLabels).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label><label>Validade<input name="expires" type="date" required/></label><label>Motivo<input name="reason" minLength={5} maxLength={500} required/></label></div><Button disabled={busy}>Criar cupom</Button>{message && <p role="status">{message}</p>}
  </form></details>;
}
