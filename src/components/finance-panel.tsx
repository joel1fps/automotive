"use client";
import { useState } from "react";
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Download,
  Plus,
  Wallet,
  Receipt,
  TrendingUp,
  BadgeDollarSign,
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
import { money } from "@/lib/catalog";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { LoadState, Pagination } from "./dashboard";
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
};
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
  const params = new URLSearchParams({
    ...(range === "custom" ? { from, to } : { range, date }),
    ...(category ? { category } : {}),
    ...(payment ? { paymentMethod: payment } : {}),
  }).toString();
  const {
    data: summary,
    loading,
    error: summaryError,
    refresh: refreshSummary,
  } = useResource<Summary>(`/api/admin/finance/summary?${params}`);
  const {
    data: entries,
    loading: entriesLoading,
    error: entriesError,
    refresh: refreshEntries,
  } = useResource<Paged<Entry>>(
    `/api/admin/transactions?${params}&page=${page}`,
  );
  const launch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api("/api/admin/transactions", {
        method: "POST",
        body: JSON.stringify({
          description: form.get("description"),
          category: form.get("category"),
          userId: clientId || undefined,
          amount: Number(form.get("amount")),
          paymentMethod: form.get("paymentMethod"),
          date: fromZonedTime(
            String(form.get("date")),
            "America/Fortaleza",
          ).toISOString(),
          notes: form.get("notes"),
        }),
      });
      setOpen(false);
      refreshSummary();
      refreshEntries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportExcel = async () => {
    setExportError("");
    try {
      const res = await fetch(`/api/admin/finance/export?${params}`);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "automotive-financeiro.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setExportError((e as Error).message);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>Faturamento</h2>
          <Button
            onClick={() => {
              setOpen(true);
              setError("");
            }}
          >
            <Plus size={17} />
            Lançamento avulso
          </Button>
        </div>
        <div className="toolbar">
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
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </>
          ) : (
            <label>
              Data de referência
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
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
          <label>
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
          </label>
          <Button variant="secondary" onClick={exportExcel}>
            <Download size={17} />
            Exportar Excel
          </Button>
        </div>
        {exportError && <p className="alert-error">{exportError}</p>}
      </section>
      <LoadState loading={loading} error={summaryError}>
        <div className="stats-grid">
          {[
            {
              icon: Wallet,
              label: "Faturamento total",
              value: money(summary?.total || 0),
            },
            {
              icon: Receipt,
              label: "Serviços no período",
              value: summary?.count || 0,
            },
            {
              icon: BadgeDollarSign,
              label: "Ticket médio",
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
                role="img"
                aria-label="Gráfico de faturamento por dia"
              >
                <ResponsiveContainer width="100%" height="100%">
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
                  role="img"
                  aria-label="Gráfico de receita por serviço"
                >
                  <ResponsiveContainer width="100%" height="100%">
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
                  role="img"
                  aria-label="Distribuição de receita por forma de pagamento"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary.byPayment.map((v) => ({
                          ...v,
                          name: paymentLabels[v.name] || v.name,
                        }))}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={65}
                        outerRadius={100}
                      >
                        {summary.byPayment.map((_, i) => (
                          <Cell
                            key={i}
                            fill={["#037c9b", "#1f4fc4", "#62cfe7"][i % 3]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value) => money(Number(value))}
                      />
                      <Legend />
                    </PieChart>
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
        <h2>Entradas do período</h2>
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
                  <th>Categoria</th>
                  <th>Pagamento</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {entries?.items.map((e) => (
                  <tr key={e._id}>
                    <td>{displayDate(e.date)}</td>
                    <td>
                      <strong>{e.description}</strong>
                      <p>{e.clientName || "Sem cliente vinculado"}</p>
                    </td>
                    <td>{e.category}</td>
                    <td>{paymentLabels[e.paymentMethod]}</td>
                    <td>{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination data={entries} page={page} setPage={setPage} />
        </LoadState>
      </section>
      <Dialog open={open} onOpenChange={setOpen} title="Novo lançamento avulso">
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
