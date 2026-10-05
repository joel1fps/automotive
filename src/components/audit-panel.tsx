"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { auditLabel, auditLabels } from "@/lib/audit-labels";
import { displayDate, useResource, type Paged } from "@/lib/client-api";
import { money, statusLabels } from "@/lib/catalog";
import { LoadState, Pagination } from "./dashboard-ui";
import { Button } from "./ui/button";

export type AuditItem = {
  _id: string;
  action: string;
  reason?: string;
  createdAt: string;
  adminClerkId?: string;
  actorName: string;
  clientName?: string;
  appointmentId?: string;
  transactionId?: string;
  fromStatus?: string;
  toStatus?: string;
  before?: number;
  after?: number;
  estimatedCompletionBefore?: string;
  estimatedCompletionAfter?: string;
  details?: { clientName?: string; serviceName?: string; vehicle?: { model?: string; plate?: string };
    scheduledAt?: string; finalPrice?: number; quotedPrice?: number };
};

export function AuditPanel() {
  const [action, setAction] = useState("appointment_deleted");
  const [page, setPage] = useState(1);
  const { data, loading, error, refresh } = useResource<Paged<AuditItem>>(
    `/api/admin/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ""}`,
    { pollMs: 30000 },
  );
  return <section className="panel">
    <div className="panel-header">
      <h2>Logs de segurança</h2>
      <Button variant="secondary" onClick={refresh} disabled={loading}><RefreshCw size={16} /> Atualizar logs</Button>
    </div>
    <p className="muted">Registros feitos pelo servidor, com data, responsável e motivo. A consulta é restrita aos administradores.</p>
    <div className="toolbar">
      <label>Ação registrada
        <select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
          <option value="">Todas as ações</option>
          {Object.entries(auditLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    <LoadState loading={loading} error={error} empty={!data?.items.length}>
      <div className="table-wrap"><table>
        <thead><tr><th>Data</th><th>Ação / atendimento</th><th>Responsável</th><th>Motivo / alterações</th></tr></thead>
        <tbody>{data?.items.map((entry) => <tr key={entry._id}>
          <td>{displayDate(entry.createdAt)}</td>
          <td>
            <strong>{auditLabel(entry.action)}</strong>
            {(entry.details?.clientName || entry.clientName) && <p>Cliente: {entry.details?.clientName || entry.clientName}</p>}
            {entry.details?.serviceName && <p>{entry.details.serviceName}</p>}
            {entry.details?.vehicle?.plate && <p>{entry.details.vehicle.model} · {entry.details.vehicle.plate}</p>}
            {entry.details?.scheduledAt && <p>Agendado: {displayDate(entry.details.scheduledAt)}</p>}
            {(entry.details?.finalPrice != null || entry.details?.quotedPrice != null) &&
              <p>Valor registrado: {money(entry.details.finalPrice ?? entry.details.quotedPrice!)}</p>}
            {entry.appointmentId && <small className="muted">Atendimento: {entry.appointmentId}</small>}
            {entry.transactionId && <p className="fine-print">Recebimento: {entry.transactionId}</p>}
          </td>
          <td><strong>{entry.actorName}</strong>{entry.adminClerkId && <p className="fine-print" style={{ overflowWrap: "anywhere" }}>{entry.adminClerkId}</p>}</td>
          <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {entry.reason || "—"}
            {entry.fromStatus && <p>{statusLabels[entry.fromStatus] || entry.fromStatus}
              {entry.toStatus && entry.toStatus !== entry.fromStatus ? ` → ${statusLabels[entry.toStatus] || entry.toStatus}` : ""}</p>}
            {entry.before != null && entry.after != null && <p>{entry.before} → {entry.after}</p>}
            {entry.estimatedCompletionAfter && <p>Entrega prevista: {displayDate(entry.estimatedCompletionAfter)}</p>}
          </td>
        </tr>)}</tbody>
      </table></div>
      <Pagination data={data} page={page} setPage={setPage} />
    </LoadState>
  </section>;
}
