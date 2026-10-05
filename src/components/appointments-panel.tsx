"use client";
import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { m } from "motion/react";
import { Plus } from "lucide-react";
import { statusLabels, money } from "@/lib/catalog";
import { appointmentClient, dateNow, displayDate, useResource, type AppointmentItem, type Paged } from "@/lib/client-api";
import { calendarDate, calendarDay, calendarDays } from "./ui/date-picker-calendar";
import { DatePicker } from "./ui/date-picker";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { LoadState, Pagination, Status } from "./dashboard-ui";

const BookingForm = dynamic(() => import("./booking-form").then((module) => module.BookingForm), {
  loading: () => <div className="skeleton" aria-label="Carregando formulário" />,
});
const OperationalActions = dynamic(() => import("./management-actions").then((module) => module.OperationalActions));

export function Appointments({
  admin = false,
  overview = false,
}: {
  admin?: boolean;
  overview?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [date, setDate] = useState(admin ? dateNow() : "");
  const [range, setRange] = useState("day");
  const [view, setView] = useState("list");
  const [page, setPage] = useState(1);
  const [manual, setManual] = useState(false);
  const {
    data,
    loading,
    error: loadError,
    refresh: refreshList,
  } = useResource<Paged<AppointmentItem>>(
    admin && view === "calendar" ? null : admin
      ? `/api/admin/appointments?page=${page}&status=${status}&date=${date}&range=${range}`
      : `/api/appointments/me?page=${page}`,
    { pollMs: 30000 },
  );
  const calendar = useResource<{ days: { date: string; total: number }[]; total: number }>(
    admin && view === "calendar" ? `/api/admin/appointments/calendar?date=${date}&range=${range}&status=${status}` : null,
    { pollMs: 30000 },
  );
  const dayCounts = new Map((calendar.data?.days || []).map((item) => [item.date, item.total]));
  const refresh = () => { refreshList(); calendar.refresh(); };
  const reference = date || dateNow();
  const weekStart = calendarDay(reference, -((calendarDate(reference)!.getUTCDay() + 6) % 7));
  const days = range === "month"
    ? calendarDays(reference).flat().filter((day): day is string => day !== null)
    : Array.from({ length: range === "week" ? 7 : 1 }, (_, index) => calendarDay(range === "week" ? weekStart : reference, index));
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>
            {overview
              ? admin
                ? "Agenda do dia"
                : "Meus próximos cuidados"
              : "Agendamentos"}
          </h2>
          {admin && (
            <Link className="button secondary" href="/admin/controle">Abrir fila operacional</Link>
          )}
          {admin && (
            <Button onClick={() => setManual(true)}>
              <Plus size={17} />
              Adicionar
            </Button>
          )}
        </div>
        {admin && (
          <div className="toolbar">
            <label>
              Data
              <DatePicker
                ariaLabel="Data dos agendamentos"
                value={date}
                onChange={(value) => {
                  setDate(value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Período
              <select
                value={range}
                onChange={(e) => {
                  setRange(e.target.value);
                  setPage(1);
                }}
              >
                <option value="day">Dia</option>
                <option value="week">Semana</option>
                <option value="month">Mês</option>
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos</option>
                {Object.entries(statusLabels)
                  .filter(([k]) =>
                    [
                      "pending",
                      "confirmed", "arrived", "in_progress", "ready", "delivered",
                      "completed",
                      "rejected",
                      "cancelled",
                      "returned",
                    ].includes(k),
                  )
                  .map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Visualização
              <select value={view} onChange={(e) => setView(e.target.value)}>
                <option value="list">Lista</option>
                <option value="calendar">Calendário</option>
              </select>
            </label>
          </div>
        )}
        <LoadState
          loading={admin && view === "calendar" ? calendar.loading : loading}
          error={admin && view === "calendar" ? calendar.error : loadError}
          empty={view !== "calendar" && !data?.items.length}
        >
          {admin && view === "calendar" ? (
            <div className="table-wrap">
              <div
                className="calendar-grid"
                style={
                  range === "day"
                    ? { gridTemplateColumns: "1fr", minWidth: 0 }
                    : undefined
                }
              >
                {days.map((day) => (
                  <div className="calendar-day" key={day}>
                    <h3>
                      {new Date(`${day}T12:00:00Z`).toLocaleDateString(
                        "pt-BR",
                        { weekday: "short", day: "2-digit", month: "2-digit", timeZone:"America/Fortaleza" },
                      )}
                    </h3>
                    <Button type="button" variant="secondary"
                      aria-label={`Ver agendamentos de ${day.split("-").reverse().join("/")}: ${dayCounts.get(day) || 0} registros`}
                      onClick={() => { setDate(day); setRange("day"); setView("list"); setPage(1); }}>
                      {dayCounts.get(day) || 0} {(dayCounts.get(day) || 0) === 1 ? "agendamento" : "agendamentos"}
                    </Button>
                  </div>
                ))}
              </div>
              <p className="fine-print" style={{ marginTop: 15 }}>
                {calendar.data?.total || 0} registros no período completo. Selecione um dia para consultar e gerenciar os atendimentos.
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data e horário</th>
                    <th>Serviço / veículo</th>
                    <th>Status</th>
                    <th>Valor</th>
                    {admin && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((a) => (
                    <m.tr layout key={a._id}>
                      <td>{displayDate(a.scheduledAt)}
                        {a.estimatedCompletionAt && <p className="fine-print">Entrega prevista: {displayDate(a.estimatedCompletionAt)}</p>}
                        {a.returnedAt && <p className="fine-print">Devolvido: {displayDate(a.returnedAt)}</p>}
                      </td>
                      <td>
                        <strong>{a.serviceName}</strong>
                        <p>
                          {a.vehicle.model} · {a.vehicle.plate}
                        </p>
                        {admin && <p>Cliente: {appointmentClient(a).name}</p>}
                        {a.notes && <p>Obs.: {a.notes}</p>}
                        {a.rejectionReason && (
                          <p>Motivo: {a.rejectionReason}</p>
                        )}
                        {a.returnReason && <p>Motivo da devolução: {a.returnReason}</p>}
                      </td>
                      <td>
                        <Status status={a.status} />
                      </td>
                      <td>
                        {a.finalPrice != null || a.quotedPrice != null ? money(a.finalPrice ?? a.quotedPrice!) : "Sob orçamento"}
                        {a.couponId && <p>Cortesia fidelidade</p>}
                      </td>
                      {admin && (
                        <td>
                          <OperationalActions appointment={a} refresh={refresh} />
                        </td>
                      )}
                    </m.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view !== "calendar" && <Pagination data={data} page={page} setPage={setPage} />}
        </LoadState>
      </section>
      <Dialog
        open={manual}
        onOpenChange={setManual}
        title="Adicionar agendamento"
      >
        <BookingForm
          admin
          onSaved={() => {
            refresh();
          }}
        />
      </Dialog>
    </>
  );
}
