"use client";
import { useEffect, useId, useState } from "react";
import { appointmentClient, displayDate, type AppointmentItem } from "@/lib/client-api";
import { money } from "@/lib/catalog";
import { phoneSchema } from "@/lib/profile";
import { OperationalActions } from "./management-actions";
import { historyCriterionLabels, type HistoryCriterion } from "@/lib/history-criteria";
import { Status } from "./dashboard-ui";
import styles from "./operational-queue.module.css";

const physicalColumns = [
  { status: "arrived", label: "Aguardando", description: "Ordem de chegada para iniciar o serviço.", since: "arrivedAt", elapsed: "Esperando" },
  { status: "in_progress", label: "Em atendimento", description: "Serviço em execução.", since: "startedAt", elapsed: "Em atendimento" },
  { status: "ready", label: "Pronto para retirada", description: "Serviço pronto; pagamento pendente.", since: "readyAt", elapsed: "Pronto há" },
  { status: "completed", label: "Pago / aguardando entrega", description: "Pagamento registrado; entrega pendente.", since: "completedAt", elapsed: "Aguardando retirada" },
] as const;

function elapsed(from: string | undefined, now: number) {
  if (!from) return "Horário não registrado";
  const timestamp = +new Date(from);
  if (!Number.isFinite(timestamp)) return "Horário não registrado";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function AppointmentContact({ appointment }: { appointment: AppointmentItem }) {
  const customer = appointmentClient(appointment);
  const parsedPhone = phoneSchema.safeParse(customer.phone);
  const whatsapp = parsedPhone.success ? parsedPhone.data : "";
  return <div className="appointment-contact">
    <p><strong>{customer.name}</strong></p>
    {whatsapp ? <a className="text-link" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" aria-label={`Abrir WhatsApp de ${customer.name}`}>{customer.phone} · WhatsApp</a> : <p className="fine-print">{customer.phone ? "Telefone precisa ser atualizado" : "Telefone não informado"}</p>}
  </div>;
}

type QueueItem = AppointmentItem & { queuePosition?: number };

function criterionDate(appointment: AppointmentItem, criterion: HistoryCriterion) {
  if (criterion === "arrived") return appointment.arrivedAt;
  if (criterion === "ready") return appointment.readyAt;
  if (criterion === "delivered") return appointment.deliveredAt || appointment.returnedAt;
  return appointment.scheduledAt;
}

export function OperationalQueue({ items, refresh, mode = "physical", counts, criterion = "scheduled" }: {
  items: QueueItem[]; refresh: () => void; mode?: "physical" | "period"; counts?: Record<string, number>; criterion?: HistoryCriterion;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState<{ id: string; status: string } | null>(null);
  const [mobileStage, setMobileStage] = useState<string>(() =>
    physicalColumns.find(column => items.some(item => item.status === column.status))?.status || "arrived",
  );
  const instanceId = useId();
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (expanded && !items.some(item => item._id === expanded.id && item.status === expanded.status)) setExpanded(null);
  }, [items, expanded]);

  const stageCount = (status: string) => counts?.[status] ?? items.filter(item => item.status === status).length;

  function card(appointment: QueueItem) {
    const open = expanded?.id === appointment._id && expanded.status === appointment.status;
    const panelId = `${instanceId}-queue-details-${appointment._id}`;
    const toggleId = `${panelId}-toggle`;
    const customer = appointmentClient(appointment);
    const column = physicalColumns.find(item => item.status === appointment.status);
    const overdue = !!appointment.estimatedCompletionAt && +new Date(appointment.estimatedCompletionAt) < now &&
      ["pending", "confirmed", "arrived", "in_progress"].includes(appointment.status);
    const position = mode === "physical" && appointment.status === "arrived" && Number.isInteger(appointment.queuePosition) && appointment.queuePosition! > 0
      ? appointment.queuePosition : undefined;
    const periodDate = criterionDate(appointment, criterion);

    return <article className={`queue-card ${styles.card} ${mode === "period" ? styles.periodCard : ""}`} key={appointment._id}
      data-appointment-id={appointment._id} data-expanded={open}>
      <div className={styles.summary}>
        <div className={styles.identity}>
          <div className={styles.plateLine}><h4>{appointment.vehicle.plate}</h4>{position && <span className={styles.position}>#{position} na fila</span>}</div>
          <p className={styles.clientName} title={customer.name}>{customer.name}</p>
          {overdue && <span className={styles.overdue} title={`Previsão: ${displayDate(appointment.estimatedCompletionAt!)}`}>Previsão ultrapassada</span>}
        </div>
        {mode === "period" && <div className={styles.status}><Status status={appointment.status} /></div>}
        <button id={toggleId} className={styles.toggle} type="button" aria-expanded={open} aria-controls={panelId}
          aria-label={`${open ? "Ver menos" : "Ver mais"} sobre o veículo ${appointment.vehicle.plate}`}
          onClick={() => setExpanded(open ? null : { id: appointment._id, status: appointment.status })}>
          {open ? "Ver menos" : "Ver mais"}<span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
      </div>
      <div id={panelId} className={styles.details} hidden={!open} role="region" aria-labelledby={toggleId}>
        {open && <>
          <p className={styles.model}>{appointment.vehicle.model}</p>
          <p className={styles.service}>{appointment.serviceName}</p>
          {appointment.walkIn && <p className={styles.note}>Entrada sem agendamento</p>}
          <AppointmentContact appointment={appointment} />
          <dl className={styles.dates}>
            {mode === "period" && <div><dt>{historyCriterionLabels[criterion]}</dt><dd>{criterion === "scheduled" && appointment.walkIn ? "Encaixe sem agendamento" : periodDate ? displayDate(periodDate) : "Horário não registrado"}</dd></div>}
            {!(mode === "period" && criterion === "scheduled") && <div><dt>Agendado</dt><dd>{appointment.walkIn ? "Encaixe sem agendamento" : displayDate(appointment.scheduledAt)}</dd></div>}
            <div><dt>Chegada</dt><dd>{appointment.arrivedAt ? displayDate(appointment.arrivedAt) : "Ainda não registrada"}</dd></div>
            {appointment.startedAt && <div><dt>Serviço iniciado em</dt><dd>{displayDate(appointment.startedAt)}</dd></div>}
            {appointment.readyAt && <div><dt>Serviço pronto em</dt><dd>{displayDate(appointment.readyAt)}</dd></div>}
            {appointment.completedAt && <div><dt>Pagamento registrado em</dt><dd>{displayDate(appointment.completedAt)}</dd></div>}
            {appointment.estimatedCompletionAt && <div><dt>Previsão de entrega</dt><dd>{displayDate(appointment.estimatedCompletionAt)}</dd></div>}
            {column && <div><dt>{column.elapsed}</dt><dd>{elapsed(appointment[column.since], now)}</dd></div>}
            {appointment.deliveredAt && <div><dt>Entregue em</dt><dd>{displayDate(appointment.deliveredAt)}</dd></div>}
            {appointment.returnedAt && <div><dt>Devolvido em</dt><dd>{displayDate(appointment.returnedAt)}</dd></div>}
            <div><dt>{["completed", "delivered"].includes(appointment.status) ? "Valor pago" : appointment.status === "returned" ? "Valor de referência" : "Valor previsto"}</dt><dd>{appointment.finalPrice != null || appointment.quotedPrice != null ? money(appointment.finalPrice ?? appointment.quotedPrice!) : "Sob orçamento"}{appointment.couponId ? " · cortesia" : ""}</dd></div>
          </dl>
          {appointment.rejectionReason && <p className={styles.note}>Motivo: {appointment.rejectionReason}</p>}
          {appointment.returnReason && <p className={styles.note}>Motivo da devolução: {appointment.returnReason}</p>}
          {appointment.notes && <p className={styles.note}>Obs.: {appointment.notes}</p>}
          <OperationalActions appointment={appointment} refresh={refresh} />
        </>}
      </div>
    </article>;
  }

  return <div className={styles.root} data-queue-mode={mode}>
    {mode === "physical" ? <>
      <label className={styles.stagePicker}>Etapa da fila
        <select value={mobileStage} onChange={event => setMobileStage(event.target.value)}>
          {physicalColumns.map(column => <option value={column.status} key={column.status}>{column.label} ({stageCount(column.status)})</option>)}
        </select>
      </label>
      <div className={styles.board}>
        {physicalColumns.map(column => {
          // The server supplies the FIFO order and the original queue position,
          // including when the administrator filters the visible vehicles.
          const vehicles = items.filter(appointment => appointment.status === column.status);
          const total = stageCount(column.status);
          return <section className={styles.column} key={column.status} aria-label={column.label}
            data-status={column.status} data-mobile-active={mobileStage === column.status}>
            <header className={styles.columnHeader}>
              <h3>{column.label}<span aria-label={`${total} veículos`}>{total}</span></h3><p>{column.description}</p>
            </header>
            {!vehicles.length && <p className={styles.empty}>{total ? "Há registros desta etapa em outras páginas." : "Nenhum veículo nesta etapa."}</p>}
            <div className={styles.cards}>{vehicles.map(card)}</div>
          </section>;
        })}
      </div>
    </> : <div className={styles.periodList} aria-label="Atendimentos do período">
      {items.length ? items.map(card) : <p className={styles.empty}>Nenhum atendimento neste período.</p>}
    </div>}
  </div>;
}
