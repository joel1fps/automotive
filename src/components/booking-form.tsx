"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { m } from "motion/react";
import { Check } from "lucide-react";
import Link from "next/link";
import { bookingSchema, vehicleSchema } from "@/lib/validation";
import { registerPageTool } from "@/lib/webmcp";
import { z } from "zod";
import { LEGAL_NOTICE, money, vehicleLabels } from "@/lib/catalog";
import {
  api,
  useResource,
  dateNow,
  type ClientItem,
  type LoyaltyData,
  type Paged,
  type ServiceItem,
} from "@/lib/client-api";
import { Button } from "./ui/button";
// No formulário, "Outros" usa um valor de serviço especial; a validação real é feita no servidor.
const OTHER = "__other__";
const formSchema = bookingSchema.extend({ serviceId: z.string().min(1, "Escolha o serviço") });
type Fields = z.input<typeof formSchema>;
export function BookingForm({
  admin = false,
  onSaved,
}: {
  admin?: boolean;
  onSaved?: () => void;
}) {
  const { data: services, error: catalogError } =
    useResource<ServiceItem[]>("/api/services");
  const { data: loyalty } = useResource<LoyaltyData>(
    admin ? null : "/api/loyalty/me",
  );
  const [clientQuery, setClientQuery] = useState("");
  const { data: clients } = useResource<Paged<ClientItem>>(
    admin
      ? `/api/admin/clients?search=${encodeURIComponent(clientQuery)}`
      : null,
  );
  const [clientId, setClientId] = useState("");
  const [guest, setGuest] = useState("");
  const [date, setDate] = useState(dateNow());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const {
    data: slots,
    error: slotError,
    loading: slotsLoading,
  } = useResource<
    { scheduledAt: string; available: boolean; remaining: number }[]
  >(`/api/slots?date=${date}`);
  const form = useForm<Fields, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      serviceId: "",
      vehicle: { type: "small", model: "", plate: "" },
      scheduledAt: "",
      notes: "",
      consent: true,
    },
  });
  const [consent, setConsent] = useState(admin);
  const [otherDesc, setOtherDesc] = useState("");
  const [otherPrice, setOtherPrice] = useState("");
  useEffect(() => {
    if (admin) return;
    return registerPageTool({
      name: "stage_vehicle_for_appointment",
      description:
        "Preenche o veículo no formulário atual. Não cria agendamento nem aceita a política de privacidade.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", minLength: 2, maxLength: 80 },
          plate: { type: "string" },
          type: { type: "string", enum: ["small", "suv", "pickup", "moto"] },
        },
        required: ["model", "plate", "type"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        const vehicle = vehicleSchema.strict().parse(input);
        form.setValue("vehicle", vehicle, { shouldValidate: true });
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return {
          vehicle: form.getValues("vehicle"),
          appointmentCreated: false,
        };
      },
    });
  }, [admin, form]);
  const vehicle = form.watch("vehicle");
  const selectedServiceId = form.watch("serviceId");
  const service = services?.find((s) => s._id === selectedServiceId);
  useEffect(() => { if (service?.vehicleTypes?.length && !service.vehicleTypes.includes(vehicle.type)) form.setValue("serviceId", ""); }, [service, vehicle.type, form]);
  const coupon = form.watch("couponId");
  const isOther = admin && form.watch("serviceId") === OTHER;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("veiculo");
    if (type && Object.keys(vehicleLabels).includes(type))
      form.setValue("vehicle.type", type as Fields["vehicle"]["type"]);
    const s = services?.find((s) => s.slug === params.get("servico"));
    if (s) form.setValue("serviceId", s._id);
  }, [services, form]);
  useEffect(() => {
    form.setValue("scheduledAt", "");
  }, [date, form]);
  useEffect(() => {
    form.setValue("couponId", undefined);
  }, [vehicle.plate, vehicle.type, service?._id, form]);
  const onSubmit = form.handleSubmit(async (fields) => {
    setError("");
    if (!admin && !consent) {
      setError("Leia e aceite a política de privacidade.");
      return;
    }
    try {
      const input = admin
        ? {
            ...fields,
            ...(fields.serviceId === OTHER
              ? {
                  serviceId: undefined,
                  custom: {
                    description: otherDesc,
                    price: Number(otherPrice.replace(",", ".")),
                  },
                }
              : {}),
            userId: clientId || undefined,
            guestName: guest || undefined,
          }
        : fields;
      await api(admin ? "/api/admin/appointments" : "/api/appointments", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  if (saved)
    return (
      <div className="empty">
        <m.div
          className="success-check"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring" }}
        >
          <Check size={32} />
        </m.div>
        <h3>{admin ? "Agendamento criado" : "Solicitação enviada"}</h3>
        <p>
          {admin
            ? "O horário já está confirmado."
            : "Aguarde a confirmação da equipe. Você pode acompanhar o pedido na sua conta."}
        </p>
        {!admin && (
          <Link
            className="button primary"
            style={{ marginTop: 24 }}
            href="/cliente/historico"
          >
            Acompanhar agendamento
          </Link>
        )}
      </div>
    );
  const errorMessages = Object.values(form.formState.errors).flatMap((e) =>
    e?.message ? [String(e.message)] : [],
  );
  return (
    <form onSubmit={onSubmit}>
      <div className="notice">
        {admin
          ? "O agendamento manual será criado como confirmado."
          : "Sua solicitação precisa da confirmação da equipe."}
        <p>
          {admin
            ? "Para polimento, PPF ou qualquer serviço fora da tabela, escolha “Outros”, descreva o serviço e defina o valor."
            : "Escolha o serviço e solicite o horário. Serviços sem preço definido dependem de orçamento e aprovação da equipe."}
        </p>
      </div>
      {admin && (
        <div className="form-grid" style={{ marginBottom: 24 }}>
          <label>
            Buscar cliente
            <input
              value={clientQuery}
              onChange={(e) => setClientQuery(e.target.value)}
              placeholder="Nome ou e-mail"
            />
          </label>
          <label>
            Cliente cadastrado
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                if (e.target.value) setGuest("");
              }}
            >
              <option value="">Cliente avulso</option>
              {clients?.items.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!clientId && (
            <label className="full">
              Nome do cliente avulso
              <input
                required
                value={guest}
                onChange={(e) => setGuest(e.target.value)}
                maxLength={120}
              />
            </label>
          )}
        </div>
      )}
      <div className="form-grid">
        <label>
          Tipo de veículo
          <select {...form.register("vehicle.type")}>
            {Object.entries(vehicleLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Serviço
          <select {...form.register("serviceId")}>
            <option value="">Escolha o serviço</option>
            {services
              ?.filter((s) => s._id && s.active && (!s.vehicleTypes?.length || s.vehicleTypes.includes(vehicle.type)))
              .map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            {admin && <option value={OTHER}>Outros (serviço à parte)</option>}
          </select>
        </label>
        {isOther && (
          <>
            <label>
              Descrição do serviço
              <input
                required
                value={otherDesc}
                onChange={(e) => setOtherDesc(e.target.value)}
                placeholder="Ex.: Polimento à parte, PPF"
                maxLength={200}
              />
            </label>
            <label>
              Valor (R$)
              <input
                required
                inputMode="decimal"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={otherPrice}
                onChange={(e) => setOtherPrice(e.target.value)}
                placeholder="0,00"
              />
            </label>
          </>
        )}
        <label>
          Modelo do veículo
          <input
            {...form.register("vehicle.model")}
            placeholder="Ex.: Chevrolet Onix"
            maxLength={80}
          />
          {form.formState.errors.vehicle?.model && (
            <span className="form-error">
              {form.formState.errors.vehicle.model.message}
            </span>
          )}
        </label>
        <label>
          Placa
          <input
            {...form.register("vehicle.plate")}
            placeholder="ABC1D23"
            maxLength={8}
            style={{ textTransform: "uppercase" }}
          />
          {form.formState.errors.vehicle?.plate && (
            <span className="form-error">
              {form.formState.errors.vehicle.plate.message}
            </span>
          )}
        </label>
        <label>
          Data
          <input
            type="date"
            value={date}
            min={dateNow()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {!admin && service?.slug === "simples" && (
          <label>
            Cupom para este veículo
            <select
              {...form.register("couponId", {
                setValueAs: (v) => v || undefined,
              })}
            >
              <option value="">Sem cupom</option>
              {loyalty?.coupons
                .filter(
                  (c) =>
                    c.status === "available" &&
                    !c.reservedAppointmentId &&
                    c.vehiclePlate ===
                      vehicle.plate.replace(/[^a-z0-9]/gi, "").toUpperCase() &&
                    c.vehicleType === vehicle.type &&
                    new Date(c.expiresAt) > new Date(),
                )
                .map((c) => (
                  <option key={c._id} value={c._id}>
                    Lavagem grátis · vence{" "}
                    {new Date(c.expiresAt).toLocaleDateString("pt-BR",{timeZone:"America/Fortaleza"})}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>Horário desejado<input type="time" value={form.watch("scheduledAt") ? new Date(form.watch("scheduledAt")).toLocaleTimeString("en-GB",{timeZone:"America/Fortaleza",hour:"2-digit",minute:"2-digit"}) : ""} onChange={e => { if (e.target.value && date) form.setValue("scheduledAt", new Date(`${date}T${e.target.value}:00-03:00`).toISOString(), {shouldValidate:true}); }} /><small>Sujeito ao expediente, capacidade e aprovação da equipe.</small></label>
        <div className="full">
          <p style={{ marginBottom: 12, fontSize: ".875rem" }}>
            Horário disponível
          </p>
          {slotsLoading ? (
            <div className="skeleton" />
          ) : (
            <div className="slot-grid">
              {slots?.map((s) => (
                <button
                  type="button"
                  key={s.scheduledAt}
                  disabled={!s.available}
                  className={
                    form.watch("scheduledAt") === s.scheduledAt
                      ? "selected"
                      : ""
                  }
                  aria-pressed={form.watch("scheduledAt") === s.scheduledAt}
                  onClick={() =>
                    form.setValue("scheduledAt", s.scheduledAt, {
                      shouldValidate: true,
                    })
                  }
                >
                  {new Date(s.scheduledAt).toLocaleTimeString("pt-BR", {
                    timeZone: "America/Fortaleza",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </button>
              ))}
            </div>
          )}
          {slots?.length === 0 && (
            <p>Sem horários disponíveis nessa data. Selecione outro dia.</p>
          )}
        </div>
        <label className="full">
          Observações
          <textarea
            {...form.register("notes")}
            placeholder="Há algum detalhe que a equipe precisa saber?"
            maxLength={1000}
          />
        </label>
      </div>
      <div className="booking-total">
        <div>
          <p>{coupon ? "Cortesia fidelidade" : "Valor da tabela"}</p>
          <span className="fine-print">
            {isOther
              ? `Outros: ${otherDesc || "descreva o serviço"}`
              : service?.name || "Selecione um serviço"}
          </span>
        </div>
        <strong>
          {isOther
            ? otherPrice !== "" && !isNaN(Number(otherPrice))
              ? money(Number(otherPrice))
              : "—"
            : coupon
            ? money(0)
            : typeof service?.prices?.[vehicle.type] === "number"
              ? money(service.prices[vehicle.type]!)
              : service ? "Sob orçamento" : "—"}
        </strong>
      </div>
      <p className="legal-notice">{LEGAL_NOTICE}</p>
      {!admin && (
        <label className="checkbox-label" style={{ marginTop: 20 }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Li a <Link href="/privacidade">política de privacidade</Link> e
            estou ciente do uso dos dados para este agendamento.
          </span>
        </label>
      )}
      {(error || catalogError || slotError || errorMessages.length > 0) && (
        <div role="alert" className="alert-error">
          {error || catalogError || slotError || errorMessages.join("; ")}
        </div>
      )}
      <div className="form-actions">
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || (!service && !isOther)}
        >
          {form.formState.isSubmitting
            ? "Enviando…"
            : admin
              ? "Criar agendamento"
              : "Solicitar agendamento"}
        </Button>
      </div>
    </form>
  );
}
