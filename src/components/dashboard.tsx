"use client";
import { Appointments } from "./appointments-panel";
import dynamic from "next/dynamic";
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
  UserRound,
} from "lucide-react";
import {
  useResource,
  displayDate,
  type LoyaltyData,
} from "@/lib/client-api";
import { vehicleLabels } from "@/lib/catalog";
import { Brand } from "./brand";
import { LoadState, Status } from "./dashboard-ui";

function PanelLoading() {
  return <div className="skeleton" role="status" aria-label="Carregando painel" />;
}
const FinancePanel = dynamic(() => import("./finance-panel").then((m) => m.FinancePanel), { loading: PanelLoading });
const BookingForm = dynamic(() => import("./booking-form").then((m) => m.BookingForm), { loading: PanelLoading });
const ProfilePanel = dynamic(() => import("./profile-panel").then((m) => m.ProfilePanel), { loading: PanelLoading });
const Clients = dynamic(() => import("./admin-panels").then((m) => m.Clients), { loading: PanelLoading });
const ServiceManager = dynamic(() => import("./admin-panels").then((m) => m.ServiceManager), { loading: PanelLoading });
const CouponManager = dynamic(() => import("./admin-panels").then((m) => m.CouponManager), { loading: PanelLoading });
const SettingsPanel = dynamic(() => import("./admin-panels").then((m) => m.SettingsPanel), { loading: PanelLoading });
const ControlPanel = dynamic(() => import("./admin-panels").then((m) => m.ControlPanel), { loading: PanelLoading });
const AuditPanel = dynamic(() => import("./audit-panel").then((m) => m.AuditPanel), { loading: PanelLoading });
const clientLinks = [
  { path: "", label: "Visão geral", icon: LayoutDashboard },
  { path: "agendar", label: "Agendar um cuidado", icon: CalendarDays },
  { path: "fidelidade", label: "Minha fidelidade", icon: Gift },
  { path: "historico", label: "Meus agendamentos", icon: History },
  { path: "perfil", label: "Meu perfil", icon: UserRound },
];
const adminLinks = [
  { path: "", label: "Visão geral", icon: LayoutDashboard },
  { path: "controle", label: "Fila e controle", icon: ClipboardList },
  { path: "agendamentos", label: "Agendamentos", icon: CalendarDays },
  { path: "clientes", label: "Clientes", icon: Users },
  { path: "servicos", label: "Serviços e preços", icon: Droplets },
  { path: "financeiro", label: "Financeiro", icon: Wallet },
  { path: "cupons", label: "Cupons", icon: Ticket },
  { path: "logs", label: "Logs", icon: History },
  { path: "configuracoes", label: "Configurações", icon: Settings },
];
export function Dashboard({
  admin = false,
  section,
  name,
  role,
}: {
  admin?: boolean;
  section: string;
  name: string;
  role?: "admin" | "client";
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
          <p>{admin || role === "admin" ? "Administrador" : "Cliente"}</p>
          <div>
            {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && <UserButton />}
          </div>
          <Link href="/">Voltar ao site</Link>
          {admin && <Link href="/cliente/perfil">Meu perfil</Link>}
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
        {admin && <Link href="/cliente/perfil">Meu perfil</Link>}
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
          {!admin && !["agendar", "perfil"].includes(section) && (
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
            ) : section === "logs" ? (
              <AuditPanel />
            ) : (
              <SettingsPanel />
            )
          ) : section === "perfil" ? (
            <ProfilePanel />
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
  const { data, loading, error } = useResource<LoyaltyData>("/api/loyalty/me", { pollMs: 30000 });
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
  const { data, loading, error } = useResource<LoyaltyData>("/api/loyalty/me", { pollMs: 30000 });
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
