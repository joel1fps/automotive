"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Plus, Wallet } from "lucide-react";
import {
  api, useResource, dateNow, displayDate,
  type AppointmentItem, type ClientItem, type CouponItem,
  type Paged, type ServiceItem,
} from "@/lib/client-api";
import { money, statusLabels, vehicleLabels } from "@/lib/catalog";
import { ServiceActions, RoleActions, CouponIssuer } from "./management-actions";
import { LoadState, Pagination, Status } from "./dashboard-ui";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { DatePicker } from "./ui/date-picker";
import { BookingForm } from "./booking-form";
import { OperationalQueue } from "./operational-queue";
import { historyCriteria, historyCriterionLabels, type HistoryCriterion } from "@/lib/history-criteria";
import { appointmentStatuses } from "@/lib/appointment-state";

export function Clients() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ClientItem | null>(null);
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicles, setVehicles] = useState<ClientItem["vehicles"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const selectedId = useRef<string | null>(null);
  selectedId.current = selected?._id || null;
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
    if (saving.current || !selected) return;
    const targetId = selected._id;
    saving.current = true;
    setError("");
    setBusy(true);
    try {
      const res = await api<ClientItem>(
        `/api/admin/clients/${targetId}${points ? "/points" : ""}`,
        {
          method: "PATCH",
          body: JSON.stringify(
            points ? { delta, reason } : { phone, vehicles },
          ),
        },
      );
      if (selectedId.current !== targetId) return;
      setSelected(res);
      setPhone(res.phone || "");
      setVehicles(res.vehicles);
      refresh();
      refreshDetail();
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
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
                        disabled={busy}
                        onClick={() => {
                          if (saving.current) return;
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
          if (!o && !saving.current) setSelected(null);
        }}
        title={selected?.name || "Cliente"}
      >
        {selected && <RoleActions client={detail?.client || selected} refresh={() => {refresh();refreshDetail();}} />}
        <div className="notice">
          Ciclo atual: {detail?.client.loyaltyCount ?? selected?.loyaltyCount}
          /10. Ajustes ficam registrados com o motivo.
        </div>
        <form onSubmit={(e) => save(e, true)}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
          </fieldset>
        </form>
        <form onSubmit={(e) => save(e, false)}>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
          </fieldset>
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
export function ServiceManager() {
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
export function CouponManager() {
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
export function SettingsPanel() {
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
      <section className="panel">
        <h2>Horários e aprovação</h2>
        <p className="notice">O cliente pode solicitar qualquer data e horário futuros. Ao aprovar o agendamento, informe a previsão de entrega do veículo.</p>
      </section>
      <details className="panel">
        <summary>Configuração de horários anteriores</summary>
        <p className="fine-print" style={{ margin: "16px 0" }}>Estas configurações preservam o controle das reservas antigas. As solicitações novas usam horário livre e aprovação do administrador.</p>
      <section className="panel settings-box">
        <h2>Funcionamento e disponibilidade</h2>
        {settings?.provisionalHours && (
          <p className="notice">
            A tabela de disponibilidade anterior está com horários provisórios.
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
          <DatePicker
            ariaLabel="Data para bloquear horários"
            value={date}
            min={dateNow()}
            onChange={setDate}
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
          Reservas existentes precisam ser reagendadas ou canceladas separadamente.
          Os bloqueios desta tabela não limitam as novas solicitações de horário livre.
        </p>
      </section>
      </details>
    </LoadState>
  );
}

export function ControlPanel() {
  const today = dateNow();
  const [mode, setMode] = useState<"period" | "physical">("physical");
  const [date, setDate] = useState(today);
  const [range, setRange] = useState("day");
  const [criterion, setCriterion] = useState<HistoryCriterion>("scheduled");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);
  const [manual, setManual] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => { setAppliedSearch(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const periodParams = new URLSearchParams(range === "custom" ? { from, to, criterion } : { date, range, criterion });
  if (appliedSearch) periodParams.set("search", appliedSearch);
  if (status) periodParams.set("status", status);
  const periodQuery = periodParams.toString();
  const physicalQuery = appliedSearch ? `?${new URLSearchParams({ search: appliedSearch })}` : "";
  const summary = useResource<{ total: number; confirmed: number; completed: number; receivable: number; periodReceivable: number; physicalReceivable: number; onSite: number; entered: number; inProgress: number; ready: number; waiting: number; awaitingPayment: number; awaitingPickup: number }>(`/api/admin/control?${mode === "period" ? periodQuery : `date=${today}`}`, { pollMs: 30000 });
  const queue = useResource<{ items: AppointmentItem[]; total: number; counts?: Record<string, number>; page?: number; pages?: number }>(mode === "period" ? `/api/admin/queue?${periodQuery}&page=${page}` : `/api/admin/queue${physicalQuery}`, { pollMs: 30000 });
  const pending = useResource<Paged<AppointmentItem>>(mode === "physical" ? `/api/admin/appointments?status=pending&page=${pendingPage}` : null, { pollMs: 30000 });
  const refresh = () => { summary.refresh(); queue.refresh(); pending.refresh(); };
  const counts = queue.data?.counts;
  const physicalStats = [
    ["Veículos no lava-jato", summary.data?.onSite],
    ["Solicitações para aprovar", pending.data?.total],
    ["Entradas hoje", summary.data?.entered],
  ];
  const periodStats = [
    ["Registros encontrados", queue.data?.total],
    ["Solicitações para aprovar", counts?.pending || 0],
    ["Entregues / devolvidos", (counts?.delivered || 0) + (counts?.returned || 0)],
  ];
  const stats = mode === "physical" ? physicalStats : periodStats;
  function changeScope(nextMode: "period" | "physical") { setMode(nextMode); setPage(1); setStatus(""); }
  function quickPeriod(nextRange: string, nextDate: string) { setMode("period"); setRange(nextRange); setDate(nextDate); setPage(1); }
  const tomorrow = new Date(+new Date(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1, 12)).toISOString().slice(0, 10);
  const pagination = queue.data && queue.data.pages !== undefined ? { pages: queue.data.pages, total: queue.data.total } : null;
  return <>
    <section className="panel">
      <h2>Fila e histórico de atendimentos</h2>
      <div className="row-actions" role="tablist" aria-label="Visualização da fila">
        <Button role="tab" aria-selected={mode === "physical"} variant={mode === "physical" ? "primary" : "secondary"} onClick={() => changeScope("physical")}>Fila atual</Button>
        <Button role="tab" aria-selected={mode === "period"} variant={mode === "period" ? "primary" : "secondary"} onClick={() => changeScope("period")}>Por data</Button>
      </div>
      {mode === "period" ? <>
        <p className="fine-print" style={{ margin: "16px 0" }}>Consulte a agenda e o histórico pela data agendada ou pela entrada, conclusão e entrega do veículo. Expanda um atendimento para ver os detalhes e as ações.</p>
        <div className="row-actions" style={{ marginBottom: 20 }}>
          <Button variant="secondary" onClick={() => quickPeriod("day", today)}>Hoje</Button>
          <Button variant="secondary" onClick={() => quickPeriod("day", tomorrow)}>Amanhã</Button>
          <Button variant="secondary" onClick={() => quickPeriod("month", `${today.slice(0, 7)}-01`)}>Mês atual</Button>
          <Button variant="secondary" onClick={() => quickPeriod("month", nextMonth)}>Próximo mês</Button>
        </div>
        <div className="toolbar">
          <label>Critério de data<select value={criterion} onChange={(event) => { setCriterion(event.target.value as HistoryCriterion); setPage(1); }}>
            {historyCriteria.map((value) => <option key={value} value={value}>{historyCriterionLabels[value]}</option>)}
          </select></label>
          <label>Período<select value={range} onChange={(event) => { setRange(event.target.value); setPage(1); }}>
            <option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option><option value="custom">Personalizado</option>
          </select></label>
          {range === "custom" ? <>
            <label>De<DatePicker ariaLabel="Data inicial da fila" value={from} onChange={(value) => { setFrom(value); setPage(1); }} /></label>
            <label>Até<DatePicker ariaLabel="Data final da fila" value={to} onChange={(value) => { setTo(value); setPage(1); }} /></label>
          </> : <label>Data de referência<DatePicker ariaLabel="Data da fila" value={date} onChange={(value) => { setDate(value); setPage(1); }} /></label>}
        </div>
      </> : <p className="fine-print" style={{ marginTop: 16 }}>Veículos presentes, de qualquer dia, em ordem de chegada. Use “Ver mais” para consultar o serviço e atualizar o atendimento.</p>}
    </section>
    <div className="stats-grid">{stats.map(([label, value]) => <div className="stat-card" key={String(label)}><p>{label}</p><strong>{queue.loading && mode === "period" ? "—" : value ?? "—"}</strong></div>)}<div className="stat-card"><Wallet size={21} /><p>{mode === "period" ? "Previsto a receber no período" : "Previsto a receber na fila"}</p><strong>{summary.data ? money(mode === "period" ? summary.data.periodReceivable : summary.data.physicalReceivable) : "—"}</strong><small>Valores definidos, antes do fechamento.</small></div></div>
    {summary.error && <p className="alert-error" role="alert">{summary.error}</p>}
    <section className="panel queue-panel">
      <div className="panel-header"><div><h2>{mode === "period" ? "Atendimentos do período" : "Fila operacional"}</h2><p className="fine-print">{mode === "period" ? `${historyCriterionLabels[criterion]}. A busca e o status consideram todas as páginas do período.` : "Ordem de chegada preservada, inclusive ao buscar um veículo."}</p></div><div className="row-actions"><Button variant="secondary" onClick={refresh}>Atualizar</Button><Button onClick={() => setManual(true)}><Plus size={17} />Entrada sem agendamento / agendar</Button></div></div>
      <div className="queue-filters">
        <label>Buscar por placa ou cliente<input type="search" aria-label="Buscar por placa ou cliente" placeholder="Placa ou nome do cliente" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} /></label>
        {mode === "period" && <label>Status<select aria-label="Status dos atendimentos" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Todos</option>{appointmentStatuses.map(value => <option key={value} value={value}>{statusLabels[value] || value}</option>)}
        </select></label>}
        {(search || status) && <Button type="button" variant="secondary" onClick={() => { setSearch(""); setAppliedSearch(""); setStatus(""); setPage(1); }}>Limpar filtros</Button>}
      </div>
      <LoadState loading={queue.loading} error={queue.error}><OperationalQueue key={mode} items={queue.data?.items || []} refresh={refresh} mode={mode} counts={counts} criterion={criterion} />
        {mode === "period" && queue.data && <p className="fine-print" style={{ marginTop: 20 }}>{queue.data.total ? `Exibindo ${(page - 1) * 100 + 1}–${Math.min(page * 100, queue.data.total)} de ${queue.data.total} registros encontrados.` : "Nenhum atendimento encontrado neste período."}</p>}
        {mode === "physical" && appliedSearch && queue.data && <p className="fine-print" style={{ marginTop: 20 }}>{queue.data.total} {queue.data.total === 1 ? "veículo encontrado" : "veículos encontrados"} na fila atual. As posições continuam seguindo a fila completa.</p>}
        {mode === "period" && <Pagination data={pagination} page={page} setPage={setPage} />}
      </LoadState>
    </section>
    {mode === "physical" && <details className="panel queue-requests">
      <summary>Solicitações para aprovar <span>{pending.data?.total ?? "—"}</span></summary>
      <p className="fine-print" style={{ marginTop: 16 }}>Pedidos ainda não aprovados. A entrada na fila ocorre ao registrar a chegada.</p>
      <LoadState loading={pending.loading} error={pending.error} empty={!pending.data?.items.length}>
        <OperationalQueue items={pending.data?.items || []} refresh={refresh} mode="period" />
        <Pagination data={pending.data} page={pendingPage} setPage={setPendingPage} />
      </LoadState>
    </details>}
    <p className="fine-print" style={{ marginBottom: 24 }}><Link className="text-link" href="/admin/agendamentos">Abrir lista completa de agendamentos e histórico</Link></p>
    <Dialog open={manual} onOpenChange={setManual} title="Entrada de veículo / agendamento manual"><BookingForm admin defaultWalkIn onSaved={refresh} /></Dialog>
  </>;
}
