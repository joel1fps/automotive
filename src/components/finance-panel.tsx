"use client";
import { useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  Plus,
  Wallet,
  Receipt,
  TrendingUp,
  BadgeDollarSign,
  ClipboardList,
} from "lucide-react";
import { fromZonedTime } from "date-fns-tz";
import {
  api,
  dateNow,
  displayDate,
  useResource,
  type Paged,
  type ClientItem,
} from "@/lib/client-api";
import { money, statusLabels } from "@/lib/catalog";
import { createRequestIdentity } from "@/lib/client-request";
import { historyCriteria, historyCriterionLabels, type HistoryCriterion } from "@/lib/history-criteria";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { DatePicker } from "./ui/date-picker";
import { LoadState, Pagination } from "./dashboard-ui";
type Summary = {
  total: number;
  count: number;
  average: number;
  previousTotal: number;
  comparison: number | null;
  byDay: { name: string; value: number }[];
  byService: { name: string; value: number }[];
  byPayment: { name: string; value: number }[];
};
type Entry = {
  _id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  paymentMethod: string;
  clientName?: string;
  source: string;
  appointmentId?: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  serviceName?: string;
  correctionOf?: string;
  action?: "refund" | "correct";
  reason?: string;
  netAmount?: number;
  corrected?: boolean;
  canCorrect?: boolean;
};
type ServiceEntry = {
  _id: string; clientName: string; vehicleModel: string; vehiclePlate: string;
  serviceName: string; category: string; status: string; value: number | null;
  quotedPrice: number | null; finalPrice: number | null; received: number;
  balance: number | null; paymentStatus: "unpaid" | "paid" | "courtesy" | "refunded";
  readyAt?: string; deliveredAt?: string; scheduledAt: string; arrivedAt?: string; returnedAt?: string; deleted: boolean;
};
type ServiceReport = Paged<ServiceEntry> & {
  summary: { count: number; paid: number; unpaid: number; totalValue: number; totalReceived: number };
};
const servicePaymentLabels = { unpaid: "Pagamento pendente", paid: "Pago", courtesy: "Cortesia", refunded: "Estornado" };
const paymentLabels: Record<string, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  card: "Cartão",
};
const tooltipStyle = {
  background: "#102537",
  border: "1px solid #3a617a",
  borderRadius: 8,
  color: "#fff",
};
export function FinancePanel() {
  const [report, setReport] = useState<"receipts" | "services">("receipts");
  const [criterion, setCriterion] = useState<"ready" | "delivered">("ready");
  const [exportCriterion, setExportCriterion] = useState<HistoryCriterion>("scheduled");
  const [range, setRange] = useState("month");
  const [date, setDate] = useState(dateNow());
  const [from, setFrom] = useState(dateNow());
  const [to, setTo] = useState(dateNow());
  const [category, setCategory] = useState("");
  const [payment, setPayment] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const { data: clients } = useResource<Paged<ClientItem>>(
    open
      ? `/api/admin/clients?search=${encodeURIComponent(clientSearch)}`
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState<"receipts" | "complete" | null>(null);
  const launchLocked = useRef(false);
  const exportLocked = useRef(false);
  const launchIdentity = useRef(createRequestIdentity());
  const correctionIdentity = useRef(createRequestIdentity());
  const correctionLocked = useRef(false);
  const [correction, setCorrection] = useState<{ entry: Entry; action: "refund" | "correct" } | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctedAmount, setCorrectedAmount] = useState("");
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const params = new URLSearchParams({
    ...(range === "custom" ? { from, to } : { range, date }),
    ...(category ? { category } : {}),
    ...(report === "receipts" && payment ? { paymentMethod: payment } : {}),
  }).toString();
  const {
    data: summary,
    loading,
    error: summaryError,
    refresh: refreshSummary,
  } = useResource<Summary>(report === "receipts" ? `/api/admin/finance/summary?${params}` : null);
  const {
    data: entries,
    loading: entriesLoading,
    error: entriesError,
    refresh: refreshEntries,
  } = useResource<Paged<Entry>>(
    report === "receipts" ? `/api/admin/transactions?${params}&page=${page}` : null,
  );
  const services = useResource<ServiceReport>(report === "services"
    ? `/api/admin/service-report?${params}&criterion=${criterion}&page=${page}` : null);
  const launch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (launchLocked.current) return;
    launchLocked.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const payload = {
        description: form.get("description"), category: form.get("category"),
        userId: clientId || undefined, amount: Number(form.get("amount")),
        paymentMethod: form.get("paymentMethod"),
        date: fromZonedTime(String(form.get("date")), "America/Fortaleza").toISOString(),
        notes: form.get("notes"),
      };
      await api("/api/admin/transactions", {
        method: "POST",
        body: JSON.stringify({ ...payload, requestId: launchIdentity.current.get(payload) }),
      });
      launchIdentity.current.reset();
      setOpen(false);
      setPage(1);
      refreshSummary();
      refreshEntries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      launchLocked.current = false;
      setBusy(false);
    }
  };
  function openCorrection(entry: Entry, action: "refund" | "correct") {
    correctionIdentity.current.reset(); setCorrection({ entry, action });
    setCorrectionReason(""); setCorrectedAmount(String(entry.netAmount ?? entry.amount)); setCorrectionError("");
  }
  async function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correction || correctionLocked.current || correctionReason.trim().length < 5) return;
    const amount = Number(correctedAmount);
    if (correction.action === "correct" && (correctedAmount === "" || !Number.isFinite(amount) || amount < 0 || amount > 1000000)) {
      setCorrectionError("Informe o valor total correto, entre R$ 0 e R$ 1.000.000."); return;
    }
    const payload = { action: correction.action, reason: correctionReason.trim(),
      ...(correction.action === "correct" ? { correctedAmount: amount } : {}) };
    correctionLocked.current = true; setCorrectionBusy(true); setCorrectionError("");
    try {
      await api(`/api/admin/transactions/${correction.entry._id}/correction`, {
        method: "POST", body: JSON.stringify({ ...payload, requestId: correctionIdentity.current.get(payload) }),
      });
      correctionIdentity.current.reset(); setCorrection(null);
      refreshSummary(); refreshEntries(); services.refresh();
    } catch (failure) { setCorrectionError((failure as Error).message); }
    finally { correctionLocked.current = false; setCorrectionBusy(false); }
  }
  const exportReport = async (type: "receipts" | "complete") => {
    if (exportLocked.current) return;
    exportLocked.current = true;
    setExporting(type);
    setExportError("");
    try {
      const mode = `&report=${type}${type === "complete" ? `&criterion=${exportCriterion}` : ""}`;
      const res = await fetch(`/api/admin/finance/export?${params}${mode}&format=xlsx`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Não foi possível exportar. Tente novamente.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(automotive-[a-z0-9.-]+)"/i)?.[1]
        || (type === "complete" ? "automotive-completo.xlsx" : "automotive-faturamento.xlsx");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      exportLocked.current = false;
      setExporting(null);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>{report === "services" ? "Serviços realizados" : "Recebimentos"}</h2>
          <Button
            onClick={() => {
              setOpen(true);
              setError("");
              setClientId("");
              setClientSearch("");
              launchIdentity.current.reset();
            }}
          >
            <Plus size={17} />
            Lançamento avulso
          </Button>
        </div>
        <div className="toolbar">
          <label>Relatório
            <select value={report} onChange={(event) => { setReport(event.target.value as "receipts" | "services"); setPage(1); }}>
              <option value="receipts">Recebimentos</option><option value="services">Serviços realizados</option>
            </select>
          </label>
          {report === "services" && <label>Considerar a data de
            <select value={criterion} onChange={(event) => { setCriterion(event.target.value as "ready" | "delivered"); setPage(1); }}>
              <option value="ready">Conclusão do serviço</option><option value="delivered">Entrega do veículo</option>
            </select>
          </label>}
          <label>
            Período
            <select
              value={range}
              onChange={(e) => {
                setRange(e.target.value);
                setPage(1);
              }}
            >
              <option value="day">Diário</option>
              <option value="week">Semanal</option>
              <option value="month">Mensal</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          {range === "custom" ? (
            <>
              <label>
                De
                <DatePicker
                  ariaLabel="Data inicial do período"
                  value={from}
                  onChange={(value) => {
                    setFrom(value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                Até
                <DatePicker
                  ariaLabel="Data final do período"
                  value={to}
                  min={from}
                  onChange={(value) => {
                    setTo(value);
                    setPage(1);
                  }}
                />
              </label>
            </>
          ) : (
            <label>
              Data de referência
              <DatePicker
                ariaLabel="Data de referência"
                value={date}
                onChange={(value) => {
                  setDate(value);
                  setPage(1);
                }}
              />
            </label>
          )}
          <label>
            Categoria
            <input
              value={category}
              maxLength={80}
              placeholder="Todas"
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            />
          </label>
          {report === "receipts" && <label>
            Pagamento
            <select
              value={payment}
              onChange={(e) => {
                setPayment(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(paymentLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>}
        </div>
        <p className="muted">
          {report === "services"
            ? "O período considera a conclusão ou entrega do veículo, incluindo serviços prontos com pagamento pendente. Os valores recebidos mostram o saldo líquido atual desses atendimentos e podem ter sido pagos em outro período."
            : "O período considera a data de cada pagamento, lançamento, correção ou estorno."}
        </p>
        <div className="finance-exports">
          <div className="row-actions">
            <Button variant="secondary" disabled={exporting !== null} onClick={() => exportReport("receipts")}>
              <Wallet size={17} />{exporting === "receipts" ? "Exportando faturamento…" : "Excel de faturamento"}
            </Button>
            <Button disabled={exporting !== null} onClick={() => exportReport("complete")}>
              <ClipboardList size={17} />{exporting === "complete" ? "Exportando completo…" : "Excel completo"}
            </Button>
          </div>
          <p className="fine-print">Faturamento: resumo e lançamentos financeiros. Completo: essas abas mais clientes, veículos, serviços, valores e datas, incluindo atendimentos sem pagamento.</p>
          <details>
            <summary>Data dos veículos no Excel completo: {historyCriterionLabels[exportCriterion]}</summary>
            <label>Considerar os veículos pela data de<select aria-label="Data dos veículos no Excel completo" value={exportCriterion} onChange={event => setExportCriterion(event.target.value as HistoryCriterion)}>
              {historyCriteria.map(value => <option key={value} value={value}>{historyCriterionLabels[value]}</option>)}
            </select></label>
            <p className="fine-print">Os recebimentos continuam usando a data financeira. O filtro de pagamento aplica-se ao faturamento; a lista de veículos também inclui quem ainda não pagou.</p>
          </details>
        </div>
        {exportError && <p className="alert-error">{exportError}</p>}
      </section>
      {report === "receipts" ? <><LoadState loading={loading} error={summaryError}>
        <div className="stats-grid">
          {[
            {
              icon: Wallet,
              label: "Recebimentos líquidos",
              value: money(summary?.total || 0),
            },
            {
              icon: Receipt,
              label: "Lançamentos no período",
              value: summary?.count || 0,
            },
            {
              icon: BadgeDollarSign,
              label: "Ticket dos lançamentos pagos",
              value: money(summary?.average || 0),
            },
            {
              icon: TrendingUp,
              label: "Período anterior",
              value:
                summary?.comparison === null
                  ? "Sem base"
                  : `${summary?.comparison.toFixed(1)}%`,
            },
          ].map((s) => (
            <div className="stat-card" key={s.label}>
              <s.icon size={21} />
              <p>{s.label}</p>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>
        {summary?.count ? (
          <>
            <section className="panel">
              <h2>Evolução do faturamento</h2>
              <div
                className="chart-box"
                style={{ overflow: "hidden" }}
                role="img"
                aria-label="Gráfico de faturamento por dia"
              >
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={summary.byDay}
                    margin={{ top: 20, right: 20, left: 5, bottom: 10 }}
                  >
                    <CartesianGrid stroke="#233e54" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#b1c0ce", fontSize: 12 }}
                      tickFormatter={(v) => String(v).slice(5)}
                    />
                    <YAxis tick={{ fill: "#b1c0ce", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value) => money(Number(value))}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      name="Faturamento"
                      stroke="#63d2ec"
                      strokeWidth={3}
                      dot={{ fill: "#1f4fc4", r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <div className="charts-grid">
              <section className="panel">
                <h2>Por serviço</h2>
                <div
                  className="chart-box"
                  style={{ overflow: "hidden" }}
                  role="img"
                  aria-label="Gráfico de receita por serviço"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={summary.byService}>
                      <CartesianGrid stroke="#233e54" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "#b1c0ce", fontSize: 12 }}
                        tickFormatter={(v) => String(v).slice(0, 12)}
                      />
                      <YAxis tick={{ fill: "#b1c0ce", fontSize: 12 }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value) => money(Number(value))}
                      />
                      <Bar
                        dataKey="value"
                        name="Receita"
                        fill="#1f4fc4"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section className="panel">
                <h2>Formas de pagamento</h2>
                <div
                  className="chart-box"
                  style={{ overflow: "hidden" }}
                  role="img"
                  aria-label="Distribuição de receita por forma de pagamento"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={summary.byPayment.map((entry) => ({ ...entry, name: paymentLabels[entry.name] || entry.name }))}>
                      <CartesianGrid stroke="#233e54" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fill: "#b1c0ce", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#b1c0ce", fontSize: 12 }} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value) => money(Number(value))}
                      />
                      <Bar dataKey="value" name="Recebido líquido" fill="#037c9b" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>
          </>
        ) : (
          <section className="panel empty">
            <Wallet size={32} />
            <p>Nenhuma entrada no período selecionado.</p>
          </section>
        )}
      </LoadState>
      <section className="panel">
        <h2>Lançamentos do período</h2>
        <p className="fine-print">O recibo original permanece no histórico. Correções e estornos aparecem como lançamentos separados; o ticket considera os lançamentos originais pagos, sem cortesias ou estornos integrais.</p>
        <LoadState
          loading={entriesLoading}
          error={entriesError}
          empty={!entries?.items.length}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente / serviço</th>
                  <th>Veículo / referência</th>
                  <th>Categoria</th>
                  <th>Pagamento</th>
                  <th>Valor</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {entries?.items.map((e) => (
                  <tr key={e._id}>
                    <td>{displayDate(e.date)}</td>
                    <td>
                      <strong>{e.description}</strong>
                      <p>{e.clientName || "Sem cliente vinculado"}</p>
                      {e.serviceName && e.serviceName !== e.description && <p>{e.serviceName}</p>}
                      {e.source === "adjustment" && <p>{e.action === "refund" ? "Estorno" : "Correção"}: {e.reason || "Ajuste registrado"}</p>}
                    </td>
                    <td><strong>{e.vehiclePlate || "—"}</strong>{e.vehicleModel && <p>{e.vehicleModel}</p>}{e.appointmentId ? <p className="finance-reference">Atendimento: <span>{e.appointmentId}</span></p> : <p>Lançamento avulso</p>}{e.correctionOf && <p className="finance-reference">Lançamento original: <span>{e.correctionOf}</span></p>}</td>
                    <td>{e.category}</td>
                    <td>{paymentLabels[e.paymentMethod]}</td>
                    <td>{money(e.amount)}{e.corrected && <p>Líquido atual: {money(e.netAmount ?? e.amount)}</p>}</td>
                    <td>{e.source !== "adjustment" && e.canCorrect !== false && <div className="row-actions">
                      <Button type="button" variant="secondary" disabled={correctionBusy} onClick={() => openCorrection(e, "correct")}>Corrigir valor</Button>
                      <Button type="button" variant="danger" disabled={correctionBusy || (e.netAmount ?? e.amount) <= 0} onClick={() => openCorrection(e, "refund")}>Estornar</Button>
                    </div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination data={entries} page={page} setPage={setPage} />
        </LoadState>
      </section>
      </> : <LoadState loading={services.loading} error={services.error}>
        <div className="stats-grid">
          {[
            { label: "Serviços realizados", value: services.data?.summary.count || 0 },
            { label: "Serviços pagos", value: services.data?.summary.paid || 0 },
            { label: "Pagamento pendente", value: services.data?.summary.unpaid || 0 },
            { label: "Recebido líquido desses serviços", value: money(services.data?.summary.totalReceived || 0) },
          ].map((stat) => <div className="stat-card" key={stat.label}><Receipt size={21} /><p>{stat.label}</p><strong>{stat.value}</strong></div>)}
        </div>
        <section className="panel">
          <h2>{criterion === "ready" ? "Serviços concluídos no período" : "Veículos entregues no período"}</h2>
          <p className="fine-print">Cortesias e atendimentos estornados têm situação própria. Serviços realizados que foram excluídos da agenda continuam neste histórico.</p>
          {!services.data?.items.length ? <div className="empty"><Receipt size={32} /><p>Nenhum serviço realizado no período selecionado.</p></div>
            : <div className="table-wrap"><table>
              <thead><tr><th>Conclusão / saída</th><th>Cliente / veículo</th><th>Serviço / status</th><th>Pagamento</th><th>Valor / recebido / saldo</th></tr></thead>
              <tbody>{services.data.items.map((entry) => <tr key={entry._id}>
                <td>{entry.readyAt ? displayDate(entry.readyAt) : "Conclusão não registrada"}<p>{entry.returnedAt && !entry.deliveredAt ? `Devolução: ${displayDate(entry.returnedAt)}` : `Saída: ${entry.deliveredAt ? displayDate(entry.deliveredAt) : "Retirada pendente"}`}</p></td>
                <td><strong>{entry.clientName}</strong><p>{entry.vehicleModel} · {entry.vehiclePlate}</p></td>
                <td><strong>{entry.serviceName}</strong><p>{statusLabels[entry.status] || entry.status}</p>{entry.deleted && <p>Excluído da agenda · histórico preservado</p>}</td>
                <td>{servicePaymentLabels[entry.paymentStatus]}</td>
                <td>Valor: {entry.value == null ? "Sob orçamento" : money(entry.value)}<p>Recebido: {money(entry.received)}</p><p>Saldo: {entry.balance == null ? "Sob orçamento" : money(entry.balance)}</p></td>
              </tr>)}</tbody>
            </table></div>}
          <Pagination data={services.data} page={page} setPage={setPage} />
        </section>
      </LoadState>}
      <Dialog open={!!correction} onOpenChange={(value) => { if (!value && !correctionBusy) setCorrection(null); }}
        title={correction?.action === "refund" ? "Estornar pagamento" : "Corrigir valor recebido"}>
        {correction && <form onSubmit={submitCorrection}>
          <div className="notice"><strong>{correction.entry.description}</strong><p>{correction.entry.clientName || "Sem cliente vinculado"}</p>
            <p>Recibo original: {money(correction.entry.amount)} · líquido atual: {money(correction.entry.netAmount ?? correction.entry.amount)}</p></div>
          <p className="muted">O recibo original será preservado. O ajuste terá seu usuário, data e motivo registrados nos logs. Um estorno integral pode ajustar a fidelidade; cupons já utilizados serão preservados.</p>
          {correction.action === "correct" && <label>Valor total correto recebido (R$)
            <input type="number" required min="0" max="1000000" step="0.01" value={correctedAmount} disabled={correctionBusy} onChange={(event) => setCorrectedAmount(event.target.value)} />
            <span className="fine-print">Informe o total correto, considerando os ajustes anteriores.</span>
          </label>}
          <label>Motivo do ajuste<textarea required minLength={5} maxLength={500} value={correctionReason} disabled={correctionBusy} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
          {correctionError && <p className="alert-error" role="alert">{correctionError}</p>}
          <div className="form-actions"><Button type="button" variant="secondary" disabled={correctionBusy} onClick={() => setCorrection(null)}>Voltar</Button>
            <Button type="submit" variant={correction.action === "refund" ? "danger" : "primary"} disabled={correctionBusy || correctionReason.trim().length < 5}>
              {correctionBusy ? "Registrando ajuste…" : correction.action === "refund" ? "Confirmar estorno" : "Confirmar correção"}
            </Button></div>
        </form>}
      </Dialog>
      <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }} title="Novo lançamento avulso">
        <form onSubmit={launch}>
          <div className="form-grid">
            <label>
              Buscar cliente (opcional)
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Nome ou e-mail"
              />
            </label>
            <label>
              Cliente
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                <option value="">Sem cliente vinculado</option>
                {clients?.items.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Descrição
              <input
                required
                name="description"
                minLength={2}
                maxLength={200}
                placeholder="Ex.: Aplicação de PPF"
              />
            </label>
            <label>
              Categoria
              <input
                required
                name="category"
                minLength={2}
                maxLength={80}
                placeholder="Ex.: PPF"
              />
            </label>
            <label>
              Valor (R$)
              <input
                required
                name="amount"
                type="number"
                min="0"
                max="1000000"
                step=".01"
              />
            </label>
            <label>
              Pagamento
              <select name="paymentMethod">
                {Object.entries(paymentLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Data e horário
              <input
                required
                name="date"
                type="datetime-local"
                defaultValue={new Date()
                  .toLocaleString("sv-SE", { timeZone: "America/Fortaleza" })
                  .replace(" ", "T")
                  .slice(0, 16)}
              />
            </label>
            <label className="full">
              Observação
              <textarea name="notes" maxLength={1000} />
            </label>
          </div>
          {error && <p className="alert-error">{error}</p>}
          <div className="form-actions">
            <Button disabled={busy}>
              {busy ? "Registrando…" : "Registrar entrada"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
