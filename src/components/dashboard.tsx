"use client";
import { ServiceActions, OperationalActions, RoleActions, CouponIssuer } from "./management-actions";
import { useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { m } from "motion/react";
import {
  CalendarDays,
  Gift,
  History,
  LayoutDashboard,
  Users,
  Droplets,
  Wallet,
  Settings,
  Ticket,
  Plus,
  Check,
  ClipboardList,
} from "lucide-react";
import { addDays, startOfWeek } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import {
  api,
  useResource,
  dateNow,
  displayDate,
  type AppointmentItem,
  type ClientItem,
  type CouponItem,
  type LoyaltyData,
  type Paged,
  type ServiceItem,
} from "@/lib/client-api";
import { money, statusLabels, vehicleLabels } from "@/lib/catalog";
import { Brand } from "./public-site";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { BookingForm } from "./booking-form";
import { FinancePanel } from "./finance-panel";
const clientLinks = [
  { path: "", label: "Visão geral", icon: LayoutDashboard },
  { path: "agendar", label: "Agendar um cuidado", icon: CalendarDays },
  { path: "fidelidade", label: "Minha fidelidade", icon: Gift },
  { path: "historico", label: "Meus agendamentos", icon: History },
];
const adminLinks = [
  { path: "", label: "Visão geral", icon: LayoutDashboard },
  { path: "controle", label: "Controle do dia", icon: ClipboardList },
  { path: "agendamentos", label: "Agendamentos", icon: CalendarDays },
  { path: "clientes", label: "Clientes", icon: Users },
  { path: "servicos", label: "Serviços e preços", icon: Droplets },
  { path: "financeiro", label: "Financeiro", icon: Wallet },
  { path: "cupons", label: "Cupons", icon: Ticket },
  { path: "configuracoes", label: "Configurações", icon: Settings },
];
export function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status}`}>{statusLabels[status] || status}</span>
  );
}
export function Pagination({
  data,
  page,
  setPage,
}: {
  data: { pages: number; total: number } | null;
  page: number;
  setPage: (page: number) => void;
}) {
  return data && data.pages > 1 ? (
    <div className="pagination">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        Anterior
      </Button>
      <span>
        {page} de {data.pages}
      </span>
      <Button
        variant="secondary"
        disabled={page >= data.pages}
        onClick={() => setPage(page + 1)}
      >
        Próxima
      </Button>
    </div>
  ) : null;
}
export function LoadState({
  loading,
  error,
  empty = false,
  children,
}: {
  loading: boolean;
  error: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return loading ? (
    <div className="skeleton" aria-label="Carregando" />
  ) : error ? (
    <p role="alert" className="alert-error">
      {error}
    </p>
  ) : empty ? (
    <div className="empty">
      <ClipboardList size={32} />
      <p>Nenhum registro encontrado.</p>
    </div>
  ) : (
    <>{children}</>
  );
}
export function Dashboard({
  admin = false,
  section,
  name,
}: {
  admin?: boolean;
  section: string;
  name: string;
}) {
  const root = admin ? "/admin" : "/cliente";
  const links = admin ? adminLinks : clientLinks;
  const current = links.find((l) => l.path === section);
  return (
    <div className="dashboard">
      <aside className="dash-sidebar">
        <Brand />
        <nav aria-label={admin ? "Administração" : "Minha conta"}>
          {links.map((l) => (
            <Link
              className={section === l.path ? "active" : ""}
              href={`${root}/${l.path}`}
              key={l.path}
            >
              <l.icon size={19} />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>{admin ? "Administrador" : "Cliente"}</p>
          <div>
            {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && <UserButton />}
          </div>
          <Link href="/">Voltar ao site</Link>
        </div>
      </aside>
      <nav className="mobile-dash-nav" aria-label="Painel">
        {links.map((l) => (
          <Link
            href={`${root}/${l.path}`}
            key={l.path}
            className={section === l.path ? "active" : ""}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <main className="dash-main">
        <div className="dash-top">
          <div>
            <p className="eyebrow">
              AUTOMOTIVE · {admin ? "GESTÃO" : "MINHA CONTA"}
            </p>
            <h1>
              {section === "" ? `Olá, ${name.split(" ")[0]}.` : current?.label}
            </h1>
            <p>
              {admin
                ? "Organize o dia e acompanhe os cuidados realizados."
                : "Seu próximo cuidado e suas recompensas estão aqui."}
            </p>
          </div>
          {!admin && section !== "agendar" && (
            <Link className="button primary" href="/cliente/agendar">
              <Plus size={18} />
              Agendar
            </Link>
          )}
        </div>
        <m.div
          key={section}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {admin ? (
            section === "financeiro" ? (
              <FinancePanel />
            ) : section === "controle" ? (
              <ControlPanel />
            ) : section === "agendamentos" || section === "" ? (
              <Appointments admin overview={section === ""} />
            ) : section === "clientes" ? (
              <Clients />
            ) : section === "servicos" ? (
              <ServiceManager />
            ) : section === "cupons" ? (
              <CouponManager />
            ) : (
              <SettingsPanel />
            )
          ) : section === "agendar" ? (
            <div className="panel" style={{ maxWidth: 950 }}>
              <h2>Solicitar um agendamento</h2>
              <BookingForm />
            </div>
          ) : section === "fidelidade" ? (
            <Loyalty />
          ) : section === "historico" ? (
            <Appointments />
          ) : (
            <>
              <ClientOverview />
              <Appointments overview />
            </>
          )}
        </m.div>
      </main>
    </div>
  );
}
function ClientOverview() {
  const { data, loading, error } = useResource<LoyaltyData>("/api/loyalty/me");
  return (
    <LoadState loading={loading} error={error}>
      <div className="stats-grid">
        <div className="stat-card">
          <Droplets size={21} />
          <p>Lavagens no ciclo</p>
          <strong>{data?.loyaltyCount} / 10</strong>
        </div>
        <div className="stat-card">
          <Gift size={21} />
          <p>Faltam para a grátis</p>
          <strong>{10 - (data?.loyaltyCount || 0)}</strong>
        </div>
        <div className="stat-card">
          <Ticket size={21} />
          <p>Cupons disponíveis</p>
          <strong>
            {
              data?.coupons.filter(
                (c) => c.status === "available" && !c.reservedAppointmentId,
              ).length
            }
          </strong>
        </div>
        <div className="stat-card">
          <Check size={21} />
          <p>Lavagens concluídas</p>
          <strong>{data?.totalWashes}</strong>
        </div>
      </div>
    </LoadState>
  );
}
function Loyalty() {
  const { data, loading, error } = useResource<LoyaltyData>("/api/loyalty/me");
  return (
    <LoadState loading={loading} error={error}>
      <section className="panel loyalty-progress">
        <h2>Seu caminho para a próxima lavagem</h2>
        <strong>{data?.loyaltyCount} / 10</strong>
        <p>
          Faltam {10 - (data?.loyaltyCount || 0)} lavagens pagas e concluídas
          para uma Lavagem Simples grátis.
        </p>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Lavagens no ciclo"
          aria-valuenow={data?.loyaltyCount || 0}
          aria-valuemin={0}
          aria-valuemax={10}
        >
          <m.div
            className="progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${(data?.loyaltyCount || 0) * 10}%` }}
          />
        </div>
        <p className="fine-print">
          A lavagem com cupom não soma pontos. Cupom válido por 30 dias, para a
          mesma placa e o mesmo tipo de veículo.
        </p>
      </section>
      <section className="panel">
        <h2>Seus cupons</h2>
        {!data?.coupons.length ? (
          <div className="empty">
            <Gift size={32} />
            <p>Conclua o ciclo para receber seu primeiro cupom.</p>
          </div>
        ) : (
          <div className="coupon-grid">
            {data.coupons.map((c) => (
              <div className="coupon-card" key={c._id}>
                <Gift size={28} />
                <div>
                  <Status status={c.status} />
                  <h3>Lavagem Simples grátis</h3>
                  <p>
                    Veículo: {c.vehiclePlate} ·{" "}
                    {vehicleLabels[c.vehicleType as keyof typeof vehicleLabels]}
                  </p>
                  <p>Válido até {displayDate(c.expiresAt)}</p>
                  {c.reservedAppointmentId && (
                    <p>Reservado para um agendamento.</p>
                  )}
                  {c.status === "available" && !c.reservedAppointmentId && (
                    <Link
                      className="text-link"
                      href="/cliente/agendar?servico=simples"
                    >
                      Usar no próximo agendamento
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </LoadState>
  );
}
function Appointments({
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
  const [selected, setSelected] = useState<AppointmentItem | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [value, setValue] = useState(0);
  const [payment, setPayment] = useState("pix");
  const [newDate, setNewDate] = useState(dateNow());
  const [newSlot, setNewSlot] = useState("");
  const {
    data,
    loading,
    error: loadError,
    refresh,
  } = useResource<Paged<AppointmentItem>>(
    admin
      ? `/api/admin/appointments?page=${page}&status=${status}&date=${date}&range=${range}`
      : `/api/appointments/me?page=${page}`,
  );
  const { data: slots } = useResource<
    { scheduledAt: string; available: boolean }[]
  >(action === "reschedule" ? `/api/slots?date=${newDate}` : null);
  const act = (item: AppointmentItem, action: string) => {
    setSelected(item);
    setAction(action);
    setError("");
    setReason("");
    setValue(item.quotedPrice || 0);
    setPayment("pix");
    setNewSlot("");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/appointments/${selected?._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          ...(action === "complete"
            ? { finalPrice: value, paymentMethod: payment }
            : action === "reschedule"
              ? { scheduledAt: newSlot }
              : { reason }),
        }),
      });
      setSelected(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const weekStart = startOfWeek(new Date(`${date || dateNow()}T12:00:00Z`), {
    weekStartsOn: 1,
  });
  const days = Array.from({ length: range === "week" ? 7 : 1 }, (_, i) =>
    (range === "week"
      ? addDays(weekStart, i)
      : new Date(`${date || dateNow()}T12:00:00Z`)
    )
      .toISOString()
      .slice(0, 10),
  );
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
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
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
          loading={loading}
          error={loadError}
          empty={!data?.items.length}
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
                    {data?.items
                      .filter(
                        (a) =>
                          new Date(a.scheduledAt).toLocaleDateString("en-CA", {
                            timeZone: "America/Fortaleza",
                          }) === day,
                      )
                      .map((a) => (
                        <div className="calendar-item" key={a._id}>
                          <strong>
                            {new Date(a.scheduledAt).toLocaleTimeString(
                              "pt-BR",
                              {
                                timeZone: "America/Fortaleza",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}{" "}
                            · {a.vehicle.plate}
                          </strong>
                          <p>{a.serviceName}</p>
                          <Status status={a.status} />
                        </div>
                      ))}
                  </div>
                ))}
              </div>
              <p className="fine-print" style={{ marginTop: 15 }}>
                O calendário mostra os registros da página atual. Use a lista
                para gerenciar as ações.
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
                      <td>{displayDate(a.scheduledAt)}</td>
                      <td>
                        <strong>{a.serviceName}</strong>
                        <p>
                          {a.vehicle.model} · {a.vehicle.plate}
                        </p>
                        {a.guestName && <p>Cliente: {a.guestName}</p>}
                        {a.notes && <p>Obs.: {a.notes}</p>}
                        {a.rejectionReason && (
                          <p>Motivo: {a.rejectionReason}</p>
                        )}
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
                          <div className="row-actions"><OperationalActions appointment={a} refresh={refresh} />
                            {a.status === "pending" && (
                              <>
                                <Button onClick={() => act(a, "confirm")}>
                                  Aceitar
                                </Button>
                                <Button
                                  variant="danger"
                                  onClick={() => act(a, "reject")}
                                >
                                  Recusar
                                </Button>
                              </>
                            )}
                            {a.status === "ready" && (
                              <Button onClick={() => act(a, "complete")}>
                                Concluir
                              </Button>
                            )}
                            {["pending", "confirmed"].includes(a.status) && (
                              <>
                                <Button
                                  variant="secondary"
                                  onClick={() => act(a, "reschedule")}
                                >
                                  Reagendar
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={() => act(a, "cancel")}
                                >
                                  Cancelar
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </m.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination data={data} page={page} setPage={setPage} />
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
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={
          {
            confirm: "Aceitar solicitação",
            reject: "Recusar solicitação",
            cancel: "Cancelar agendamento",
            complete: "Concluir serviço",
            reschedule: "Reagendar",
          }[action] || "Agendamento"
        }
      >
        <p>
          {selected?.serviceName} · {selected?.vehicle.plate}
        </p>
        <form onSubmit={save}>
          {action === "complete" ? (
            <div className="form-grid">
              <label>
                Valor final (R$)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={selected?.couponId ? 0 : value}
                  disabled={!!selected?.couponId}
                  onChange={(e) => setValue(Number(e.target.value))}
                />
              </label>
              <label>
                Pagamento
                <select
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="pix">Pix</option>
                  <option value="cash">Dinheiro</option>
                  <option value="card">Cartão</option>
                </select>
              </label>
              {selected?.couponId && (
                <p className="full notice">
                  Cortesia fidelidade: valor R$ 0,00 e sem ponto no próximo
                  ciclo.
                </p>
              )}
            </div>
          ) : action === "reschedule" ? (
            <div className="form-grid">
              <label>
                Nova data
                <input
                  type="date"
                  min={dateNow()}
                  value={newDate}
                  onChange={(e) => {
                    setNewDate(e.target.value);
                    setNewSlot("");
                  }}
                />
              </label>
              <label>
                Horário
                <select
                  required
                  value={newSlot}
                  onChange={(e) => setNewSlot(e.target.value)}
                >
                  <option value="">Escolha um horário</option>
                  {slots
                    ?.filter((s) => s.available)
                    .map((s) => (
                      <option key={s.scheduledAt} value={s.scheduledAt}>
                        {displayDate(s.scheduledAt)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ) : action !== "confirm" ? (
            <label>
              Motivo (opcional)
              <textarea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          ) : (
            <p>A solicitação passará a confirmada.</p>
          )}
          {error && (
            <p className="alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setSelected(null)}
            >
              Voltar
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "Salvando…" : "Confirmar ação"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
function Clients() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ClientItem | null>(null);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicles, setVehicles] = useState<ClientItem["vehicles"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const {
    data,
    loading,
    error: loadError,
    refresh,
  } = useResource<Paged<ClientItem>>(
    `/api/admin/clients?search=${encodeURIComponent(search)}&page=${page}`,
  );
  const { data: detail, refresh: refreshDetail } = useResource<{
    client: ClientItem;
    appointments: AppointmentItem[];
    audit: {
      _id: string;
      before: number;
      after: number;
      reason: string;
      createdAt: string;
    }[];
  }>(selected ? `/api/admin/clients/${selected._id}` : null);
  const save = async (e: React.FormEvent, points: boolean) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api<ClientItem>(
        `/api/admin/clients/${selected?._id}${points ? "/points" : ""}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            points ? { delta, reason } : { phone, vehicles },
          ),
        },
      );
      setSelected(res);
      refresh();
      refreshDetail();
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <h2>Clientes</h2>
        <div className="toolbar">
          <label>
            Buscar por nome ou e-mail
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar cliente"
              maxLength={100}
            />
          </label>
        </div>
        <LoadState
          loading={loading}
          error={loadError}
          empty={!data?.items.length}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Veículos</th>
                  <th>Fidelidade</th>
                  <th>Histórico</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((c) => (
                  <tr key={c._id}>
                    <td>
                      <strong>{c.name}</strong>
                      <p>{c.email}</p>
                    </td>
                    <td>{c.vehicles.map((v) => v.plate).join(", ") || "—"}</td>
                    <td>
                      {c.loyaltyCount}/10 · {c.totalWashes} lavagens
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSelected(c);
                          setPhone(c.phone || "");
                          setVehicles(c.vehicles);
                          setError("");
                        }}
                      >
                        Ver cliente
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination data={data} page={page} setPage={setPage} />
        </LoadState>
      </section>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        title={selected?.name || "Cliente"}
      >
        {selected && <RoleActions client={detail?.client || selected} refresh={() => {refresh();refreshDetail();}} />}
        <div className="notice">
          Ciclo atual: {detail?.client.loyaltyCount ?? selected?.loyaltyCount}
          /10. Ajustes ficam registrados com o motivo.
        </div>
        <form onSubmit={(e) => save(e, true)}>
          <div className="form-grid">
            <label>
              Ajuste de pontos
              <input
                type="number"
                min="-9"
                max="9"
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
              />
            </label>
            <label>
              Motivo obrigatório
              <input
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <div className="form-actions">
            <Button disabled={busy}>Registrar ajuste</Button>
          </div>
        </form>
        <form onSubmit={(e) => save(e, false)}>
          <label>
            Telefone
            <input
              maxLength={25}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <h3 style={{ marginTop: 24 }}>Veículos cadastrados</h3>
          {vehicles.map((v, i) => (
            <div className="form-grid client-vehicle" key={i}>
              <label>
                Modelo
                <input
                  required
                  maxLength={80}
                  value={v.model}
                  onChange={(e) =>
                    setVehicles(
                      vehicles.map((item, j) =>
                        j === i ? { ...item, model: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Placa
                <input
                  required
                  maxLength={8}
                  value={v.plate}
                  onChange={(e) =>
                    setVehicles(
                      vehicles.map((item, j) =>
                        j === i ? { ...item, plate: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Tipo
                <select
                  value={v.type}
                  onChange={(e) =>
                    setVehicles(
                      vehicles.map((item, j) =>
                        j === i
                          ? {
                              ...item,
                              type: e.target
                                .value as ClientItem["vehicles"][number]["type"],
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {Object.entries(vehicleLabels).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setVehicles(vehicles.filter((_, j) => j !== i))}
              >
                Remover veículo
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            style={{ marginTop: 16 }}
            disabled={vehicles.length >= 20}
            onClick={() =>
              setVehicles([
                ...vehicles,
                { model: "", plate: "", type: "small" },
              ])
            }
          >
            Adicionar veículo
          </Button>
          <div className="form-actions">
            <Button variant="secondary" disabled={busy}>
              Salvar dados do cliente
            </Button>
          </div>
        </form>
        {error && <p className="alert-error">{error}</p>}
        <h3 style={{ marginTop: 25 }}>Histórico de serviços</h3>
        <div className="table-wrap">
          <table>
            <tbody>
              {detail?.appointments.map((a) => (
                <tr key={a._id}>
                  <td>{displayDate(a.scheduledAt)}</td>
                  <td>
                    {a.serviceName} · {a.vehicle.plate}
                  </td>
                  <td>
                    <Status status={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 25 }}>Ajustes registrados</h3>
        {detail?.audit.map((a) => (
          <p key={a._id} className="fine-print">
            {displayDate(a.createdAt)} · {a.before} → {a.after} · {a.reason}
          </p>
        ))}
      </Dialog>
    </>
  );
}
function ServiceManager() {
  const { data, loading, error, refresh } = useResource<ServiceItem[]>(
    "/api/admin/services",
  );
  const [selected, setSelected] = useState<Partial<ServiceItem> | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const blank = {
    name: "",
    slug: "",
    category: "extra" as const,
    prices: null,
    countsForLoyalty: false,
    active: true,
    description: "",
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      await api(
        `/api/admin/services${selected?._id ? `/${selected._id}` : ""}`,
        {
          method: selected?._id ? "PATCH" : "POST",
          body: JSON.stringify({...selected,vehicleTypes:selected?.vehicleTypes ?? []}),
        },
      );
      setSelected(null);
      refresh();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>Catálogo de serviços</h2><Button variant="secondary" disabled={busy} onClick={async()=>{if(!confirm("Restaurar todos os serviços originais e seus preços? Serviços personalizados e agendamentos serão preservados."))return;setBusy(true);setFormError("");try{await api("/api/admin/catalog-reset",{method:"POST",body:"{}"});refresh();}catch(e){setFormError((e as Error).message);}finally{setBusy(false);}}}>Restaurar catálogo original</Button>
          <Button onClick={() => setSelected(blank)}>
            <Plus size={17} />
            Novo serviço
          </Button>
        </div>
        {formError && <p role="alert" className="alert-error">{formError}</p>}<LoadState loading={loading} error={error} empty={!data?.length}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Serviço</th>
                  <th>Carro pequeno</th>
                  <th>SUV</th>
                  <th>Caminhonete</th><th>Moto</th>
                  <th>Situação</th>
                  <th>Editar</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((s) => (
                  <tr key={s._id}>
                    <td>
                      <strong>{s.name}</strong>
                      <p>
                        {s.countsForLoyalty
                          ? "Soma fidelidade"
                          : "Não soma fidelidade"}
                      </p>
                    </td>
                    {["small", "suv", "pickup", "moto"].map((v) => (
                      <td key={v}>
                        {typeof s.prices?.[v as keyof NonNullable<typeof s.prices>] === "number"
                          ? money(s.prices![v as keyof NonNullable<typeof s.prices>]!)
                          : "Sob consulta"}
                      </td>
                    ))}
                    <td>{s.active ? "Ativo" : "Inativo"}</td>
                    <td>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSelected(s);
                          setFormError("");
                        }}
                      >
                        Editar
                      </Button><ServiceActions id={s._id} refresh={refresh} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LoadState>
      </section>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        title={selected?._id ? "Editar serviço" : "Novo serviço"}
      >
        <form onSubmit={save}>
          <div className="form-grid">
            <label>
              Nome
              <input
                required
                minLength={2}
                maxLength={100}
                value={selected?.name || ""}
                onChange={(e) =>
                  setSelected({ ...selected, name: e.target.value })
                }
              />
            </label>
            <label>
              Identificador
              <input
                required
                pattern="[a-z0-9-]+"
                maxLength={100}
                disabled={!!selected?._id}
                value={selected?.slug || ""}
                onChange={(e) =>
                  setSelected({ ...selected, slug: e.target.value })
                }
              />
            </label>
            <label>
              Categoria
              <select
                value={selected?.category || "extra"}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    category: e.target.value as "wash" | "extra",
                    prices:
                      e.target.value === "wash"
                        ? selected?.prices || { small: 0, suv: 0, pickup: 0, moto: 0 }
                        : null,
                  })
                }
              >
                <option value="wash">Lavagem</option>
                <option value="extra">Serviço extra</option>
              </select>
            </label>
            <label>
              Preço
              <select
                value={selected?.prices ? "priced" : "consult"}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    prices:
                      e.target.value === "priced"
                        ? { small: 0, suv: 0, pickup: 0 }
                        : null,
                  })
                }
              >
                <option value="priced">Por tipo de veículo</option>
                <option value="consult">Sob consulta</option>
              </select>
            </label>
            {selected?.prices &&
              Object.entries(vehicleLabels).map(([v, l]) => (
                <label key={v}>
                  {l} (R$)
                  <input
                    required={v !== "moto"}
                    type="number"
                    min="0"
                    step=".01"
                    value={selected.prices![v as keyof typeof selected.prices] ?? ""}
                    onChange={(e) =>
                      setSelected({
                        ...selected,
                        prices: {
                          ...selected.prices!,
                          [v]: e.target.value === "" && v === "moto" ? undefined : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            <fieldset className="full"><legend>Tipos de veículo atendidos (nenhum marcado = todos)</legend>{Object.entries(vehicleLabels).map(([value,label])=><label className="checkbox-label" key={value}><input type="checkbox" checked={selected?.vehicleTypes?.includes(value) || false} onChange={e=>{const values=selected?.vehicleTypes || [];setSelected({...selected,vehicleTypes:e.target.checked?[...values,value]:values.filter(v=>v!==value)});}}/>{label}</label>)}</fieldset>
            <label className="full">Imagem do card (URL HTTPS ou arquivo)<input value={selected?.imageUrl || ""} onChange={e=>setSelected({...selected,imageUrl:e.target.value})} placeholder="https://..."/><input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>140000){setFormError("Use uma imagem JPG, PNG ou WebP de até 140 KB.");return;}const reader=new FileReader();reader.onload=()=>setSelected(previous=>({...previous,imageUrl:String(reader.result)}));reader.readAsDataURL(file);}} /></label>
            <label className="full">
              Descrição
              <textarea
                maxLength={500}
                value={selected?.description || ""}
                onChange={(e) =>
                  setSelected({ ...selected, description: e.target.value })
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={selected?.active ?? true}
                onChange={(e) =>
                  setSelected({ ...selected, active: e.target.checked })
                }
              />
              Serviço ativo
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={selected?.countsForLoyalty || false}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    countsForLoyalty: e.target.checked,
                  })
                }
              />
              Conta para fidelidade
            </label>
          </div>
          {formError && <p className="alert-error">{formError}</p>}
          <div className="form-actions">
            <Button disabled={busy}>
              {busy ? "Salvando…" : "Salvar serviço"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
function CouponManager() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, loading, error, refresh } = useResource<Paged<CouponItem>>(
    `/api/admin/coupons?page=${page}&status=${status}`,
  );
  return (
    <section className="panel">
      <h2>Cupons de fidelidade</h2><CouponIssuer refresh={refresh} />
      <div className="toolbar">
        <label>
          Situação
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="available">Disponíveis</option>
            <option value="used">Usados</option>
            <option value="expired">Vencidos</option>
          </select>
        </label>
      </div>
      <LoadState loading={loading} error={error} empty={!data?.items.length}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Veículo</th>
                <th>Emitido em</th>
                <th>Validade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c._id}>
                  <td>
                    {c.vehiclePlate} ·{" "}
                    {vehicleLabels[c.vehicleType as keyof typeof vehicleLabels]}
                  </td>
                  <td>{displayDate(c.issuedAt)}</td>
                  <td>{displayDate(c.expiresAt)}</td>
                  <td>
                    <Status status={c.status} />
                    {c.reservedAppointmentId && <p>Reservado</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination data={data} page={page} setPage={setPage} />
      </LoadState>
    </section>
  );
}
type BusinessSettings = {
  loyaltyTarget: 10;
  couponValidityDays: 30;
  couponSameVehicleType: true;
  slotDuration: number;
  capacityPerSlot: number;
  openingDays: number[];
  openTime: string;
  closeTime: string;
  provisionalHours: boolean;
};
function SettingsPanel() {
  const { data, loading, error, refresh } = useResource<BusinessSettings>(
    "/api/admin/settings",
  );
  const [draft, setDraft] = useState<BusinessSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(dateNow());
  const { data: slots, refresh: refreshSlots } = useResource<
    { scheduledAt: string; used: number; blocked: boolean; capacity: number }[]
  >(`/api/admin/slots?date=${date}`);
  const settings = draft || data;
  const update = (key: keyof BusinessSettings, value: unknown) => {
    if (settings) setDraft({ ...settings, [key]: value });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaveError("");
    try {
      await api("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setMessage("Configurações salvas.");
      refresh();
      refreshSlots();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const block = async (slot: { scheduledAt: string; blocked: boolean }) => {
    try {
      await api("/api/admin/slots", {
        method: "PATCH",
        body: JSON.stringify({ ...slot, blocked: !slot.blocked }),
      });
      refreshSlots();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };
  const setCapacity = async (
    slot: { scheduledAt: string; blocked: boolean },
    capacity: number,
  ) => {
    try {
      await api("/api/admin/slots", {
        method: "PATCH",
        body: JSON.stringify({ ...slot, capacity }),
      });
      refreshSlots();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };
  return (
    <LoadState loading={loading} error={error}>
      <section className="panel settings-box">
        <h2>Funcionamento e disponibilidade</h2>
        {settings?.provisionalHours && (
          <p className="notice">
            Horários provisórios. Confirme a operação do estabelecimento antes
            de abrir os agendamentos ao público.
          </p>
        )}
        <form onSubmit={save}>
          <div className="form-grid">
            <label>
              Abertura
              <input
                type="time"
                value={settings?.openTime || "08:00"}
                onChange={(e) => update("openTime", e.target.value)}
              />
            </label>
            <label>
              Fechamento
              <input
                type="time"
                value={settings?.closeTime || "17:00"}
                onChange={(e) => update("closeTime", e.target.value)}
              />
            </label>
            <label>
              Intervalo entre horários (minutos)
              <input
                type="number"
                min="15"
                max="240"
                value={settings?.slotDuration || 60}
                onChange={(e) => update("slotDuration", Number(e.target.value))}
              />
            </label>
            <label>
              Capacidade por horário
              <input
                type="number"
                min="1"
                max="30"
                value={settings?.capacityPerSlot || 1}
                onChange={(e) =>
                  update("capacityPerSlot", Number(e.target.value))
                }
              />
            </label>
            <div className="full toolbar">
              {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(
                (label, i) => (
                  <label
                    className="checkbox-label"
                    key={label}
                    style={{ minWidth: 70 }}
                  >
                    <input
                      type="checkbox"
                      checked={settings?.openingDays.includes(i) || false}
                      onChange={(e) =>
                        update(
                          "openingDays",
                          e.target.checked
                            ? [...(settings?.openingDays || []), i]
                            : (settings?.openingDays || []).filter(
                                (v) => v !== i,
                              ),
                        )
                      }
                    />
                    {label}
                  </label>
                ),
              )}
            </div>
            <label className="checkbox-label full">
              <input
                type="checkbox"
                checked={!settings?.provisionalHours}
                onChange={(e) => update("provisionalHours", !e.target.checked)}
              />
              Os horários foram confirmados pelo estabelecimento.
            </label>
          </div>
          <div className="notice" style={{ marginTop: 20 }}>
            Fidelidade: 10 lavagens pagas, cupom válido por 30 dias, vinculado à
            mesma placa e ao mesmo tipo de veículo.
          </div>
          {message && (
            <p className="alert-success">
              <Check size={20} />
              {message}
            </p>
          )}
          {saveError && <p className="alert-error">{saveError}</p>}
          <div className="form-actions">
            <Button disabled={busy}>Salvar configurações</Button>
          </div>
        </form>
      </section>
      <section className="panel settings-box">
        <h2>Bloquear horários</h2>
        <label style={{ maxWidth: 250, marginBottom: 22 }}>
          Data
          <input
            type="date"
            value={date}
            min={dateNow()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="slot-grid">
          {slots?.map((s) => (
            <div key={`${s.scheduledAt}-${s.capacity}`}>
              <button
                className={s.blocked ? "selected" : ""}
                onClick={() => block(s)}
                aria-pressed={s.blocked}
              >
                {new Date(s.scheduledAt).toLocaleTimeString("pt-BR", {
                  timeZone: "America/Fortaleza",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <br />
                {s.blocked ? "Bloqueado" : `${s.used}/${s.capacity}`}
              </button>
              <label style={{ marginTop: 8, fontSize: ".875rem" }}>
                Capacidade
                <input
                  type="number"
                  min={Math.max(1, s.used)}
                  max={30}
                  defaultValue={s.capacity}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value !== s.capacity) setCapacity(s, value);
                  }}
                />
              </label>
            </div>
          ))}
        </div>
        <p className="fine-print" style={{ marginTop: 18 }}>
          Bloquear impede novas solicitações. Reservas existentes precisam ser
          reagendadas ou canceladas separadamente.
        </p>
      </section>
    </LoadState>
  );
}

function ControlPanel() {
  const today = dateNow();
  const [dayPage, setDayPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const summary = useResource<{ total: number; confirmed: number; completed: number; receivable: number; onSite:number; entered:number; inProgress:number; ready:number }>(`/api/admin/control?date=${today}`);
  const day = useResource<Paged<AppointmentItem>>(
    `/api/admin/appointments?date=${today}&range=day&status=active&page=${dayPage}`,
  );
  const pending = useResource<Paged<AppointmentItem>>(
    `/api/admin/appointments?status=pending&page=${pendingPage}`,
  );
  const [selected, setSelected] = useState<AppointmentItem | null>(null);
  const [action, setAction] = useState("");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [payment, setPayment] = useState("pix");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const refresh = () => {
    setDayPage(1);
    setPendingPage(1);
    summary.refresh();
    day.refresh();
    pending.refresh();
  };
  const patch = async (item: AppointmentItem, body: object) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/appointments/${item._id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSelected(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (item: AppointmentItem, next: string) => {
    setSelected(item);
    setAction(next);
    setReason("");
    setValue(String(item.quotedPrice || 0));
    setPayment("pix");
    setError("");
  };
  const cars = (day.data?.items || []).filter(
    (a) => !["rejected", "cancelled"].includes(a.status),
  );
  const time = (v: string) =>
    new Date(v).toLocaleTimeString("pt-BR", {
      timeZone: "America/Fortaleza",
      hour: "2-digit",
      minute: "2-digit",
    });
  const queue = pending.data?.items || [];
  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <ClipboardList size={22} />
          <p>Agendamentos hoje</p>
          <strong>{summary.data?.total ?? "—"}</strong>
        </div>
        <div className="stat-card">
          <Check size={22} />
          <p>Aguardando aprovação</p>
          <strong>{pending.data?.total ?? "—"}</strong>
        </div>
        <div className="stat-card">
          <Droplets size={22} />
          <p>Para lavar / concluídos</p>
          <strong>
            {summary.data?.confirmed ?? "—"} / {summary.data?.completed ?? "—"}
          </strong>
        </div>
        <div className="stat-card">
          <Wallet size={22} />
          <p>A receber hoje</p>
          <strong>{summary.data ? money(summary.data.receivable) : "—"}</strong>
        </div>
      </div>
      <div className="stats-grid">{[["Veículos no lava-jato",summary.data?.onSite],["Entradas hoje",summary.data?.entered],["Em andamento",summary.data?.inProgress],["Prontos para retirada",summary.data?.ready]].map(([label,value])=><div className="stat-card" key={String(label)}><p>{label}</p><strong>{value ?? "—"}</strong></div>)}</div>
      {summary.error && <p className="alert-error" role="alert">{summary.error}</p>}
      {error && !selected && (
        <p className="alert-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="panel-header">
          <h2>Solicitações para aprovar</h2>
        </div>
        <LoadState
          loading={pending.loading}
          error={pending.error}
          empty={!queue.length}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data e horário</th>
                  <th>Serviço / veículo</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((a) => (
                  <tr key={a._id}>
                    <td>{displayDate(a.scheduledAt)}</td>
                    <td>
                      <strong>{a.serviceName}</strong>
                      <p>
                        {a.vehicle.model} · {a.vehicle.plate}
                      </p>
                      {a.guestName && <p>Cliente: {a.guestName}</p>}
                      {a.notes && <p>Obs.: {a.notes}</p>}
                    </td>
                    <td>{a.quotedPrice != null ? money(a.quotedPrice) : "Sob orçamento"}</td>
                    <td>
                      <div className="row-actions">
                        <Button
                          disabled={busy}
                          onClick={() => patch(a, { action: "confirm" })}
                        >
                          Aprovar
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => open(a, "reject")}
                        >
                          Não aprovar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LoadState>
        <Pagination data={pending.data} page={pendingPage} setPage={setPendingPage} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Carros do dia</h2>
          <Button onClick={() => setManual(true)}>
            <Plus size={17} />
            Adicionar
          </Button>
        </div>
        <LoadState
          loading={day.loading}
          error={day.error}
          empty={!cars.length}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Veículo</th>
                  <th>Serviço</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {cars.map((a) => (
                  <tr key={a._id}>
                    <td>{time(a.scheduledAt)}</td>
                    <td>
                      <strong>{a.vehicle.plate}</strong>
                      <p>{a.vehicle.model}</p>
                      {a.guestName && <p>Cliente: {a.guestName}</p>}
                    </td>
                    <td>
                      {a.serviceName}
                      {a.notes && <p>Obs.: {a.notes}</p>}
                    </td>
                    <td>
                      <Status status={a.status} />
                    </td>
                    <td>{money(a.finalPrice ?? a.quotedPrice ?? 0)}</td>
                    <td>
                      <div className="row-actions"><OperationalActions appointment={a} refresh={refresh} />
                        {a.status === "pending" && (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() => patch(a, { action: "confirm" })}
                            >
                              Aprovar
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => open(a, "reject")}
                            >
                              Não aprovar
                            </Button>
                          </>
                        )}
                        {a.status === "ready" && (
                          <Button onClick={() => open(a, "complete")}>
                            Concluir
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LoadState>
      </section>
      <Pagination data={day.data} page={dayPage} setPage={setDayPage} />
      <Dialog
        open={manual}
        onOpenChange={setManual}
        title="Adicionar agendamento"
      >
        <BookingForm admin onSaved={refresh} />
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        title={action === "complete" ? "Concluir serviço" : "Não aprovar"}
      >
        <p>
          {selected?.serviceName} · {selected?.vehicle.plate}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!selected) return;
            patch(
              selected,
              action === "complete"
                ? {
                    action,
                    finalPrice: selected.couponId ? 0 : Number(value),
                    paymentMethod: payment,
                  }
                : { action, reason },
            );
          }}
        >
          {action === "complete" ? (
            <div className="form-grid">
              <label>
                Valor final (R$)
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  required
                  value={selected?.couponId ? "0" : value}
                  disabled={!!selected?.couponId}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <label>
                Pagamento
                <select
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="pix">Pix</option>
                  <option value="cash">Dinheiro</option>
                  <option value="card">Cartão</option>
                </select>
              </label>
            </div>
          ) : (
            <label>
              Motivo (opcional)
              <textarea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setSelected(null)}
            >
              Voltar
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "Salvando…" : "Confirmar ação"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
