"use client";
import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, appointmentClient, displayDate, type AppointmentItem } from "@/lib/client-api";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { physicalQueueStatuses } from "@/lib/appointment-state";

export function DeleteAppointmentAction({ appointment, refresh, disabled = false, onBusyChange }: {
  appointment: AppointmentItem;
  refresh: () => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const vehicleOnSite = (physicalQueueStatuses as readonly string[]).includes(appointment.status);
  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || vehicleOnSite || reason.trim().length < 5) return;
    locked.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await api(`/api/admin/appointments/${appointment._id}`, {
        method: "DELETE", body: JSON.stringify({ reason: reason.trim() }),
      });
      setOpen(false);
      refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return <>
    <Button type="button" variant="danger" disabled={disabled || busy || vehicleOnSite}
      title={vehicleOnSite ? "Registre a entrega ou devolução do veículo antes de excluir o agendamento." : undefined} onClick={() => {
      setReason(""); setError(""); setOpen(true);
    }}>
      <Trash2 size={16} /> Excluir agendamento
    </Button>
    {vehicleOnSite && <p className="fine-print">Veículo no local: registre a entrega ou devolução antes de excluir.</p>}
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }} title="Excluir agendamento"
      description="Confirme o atendimento e informe o motivo para registrar a exclusão no log de segurança.">
      <div className="notice">
        <strong>{appointmentClient(appointment).name}</strong>
        <p>{appointment.serviceName} · {appointment.vehicle.model} · {appointment.vehicle.plate}</p>
        <p>{displayDate(appointment.scheduledAt)}</p>
      </div>
      <p className="muted">
        O agendamento sairá das listas e da fila, e o link de acompanhamento será desativado.
        Pagamentos já registrados e o histórico de auditoria serão preservados.
      </p>
      {vehicleOnSite && <p className="alert-error" role="alert">O veículo está no local. Registre a entrega ou devolução antes de excluir este atendimento.</p>}
      <form onSubmit={remove}>
        <label>Motivo da exclusão
          <textarea required minLength={5} maxLength={500} disabled={busy} value={reason}
            placeholder="Ex.: agendamento duplicado" onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className="fine-print">Informe pelo menos 5 caracteres. Seu usuário, a data e o motivo ficarão registrados em Logs.</p>
        {error && <p className="alert-error" role="alert">{error}</p>}
        <div className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Voltar</Button>
          <Button type="submit" variant="danger" disabled={busy || vehicleOnSite || reason.trim().length < 5}>
            {busy ? "Excluindo…" : "Confirmar exclusão"}
          </Button>
        </div>
      </form>
    </Dialog>
  </>;
}
