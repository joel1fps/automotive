"use client";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { m } from "motion/react";
import { Check } from "lucide-react";
import Link from "next/link";
import { bookingSchema, vehicleSchema } from "@/lib/validation";
import { phoneSchema } from "@/lib/profile";
import { localDateTimeToIso } from "@/lib/local-date-time";
import { createRequestIdentity } from "@/lib/client-request";
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
import { DateTimePicker } from "./ui/date-time-picker";
// No formulário, "Outros" usa um valor de serviço especial; a validação real é feita no servidor.
const OTHER = "__other__";
const formSchema = bookingSchema.extend({
  serviceId: z.string().min(1, "Escolha o serviço"),
  scheduledAt: z.string().optional(),
  walkIn: z.boolean().default(false),
}).superRefine((value, context) => {
  if (!value.walkIn && !z.iso.datetime({ offset: true }).safeParse(value.scheduledAt).success)
    context.addIssue({ code: "custom", path: ["scheduledAt"], message: "Escolha uma data e horário válidos" });
});
type Fields = z.input<typeof formSchema>;
export function BookingForm({
  admin = false,
  onSaved,
  defaultWalkIn = false,
}: {
  admin?: boolean;
  onSaved?: () => void;
  defaultWalkIn?: boolean;
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
  const [guestPhone, setGuestPhone] = useState("");
  const [guestPhoneError, setGuestPhoneError] = useState("");
  const guestPhoneInput = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(dateNow());
  const [requestedTime, setRequestedTime] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const requestIdentity = useRef(createRequestIdentity());
  const form = useForm<Fields, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      serviceId: "",
      vehicle: { type: "small", model: "", plate: "" },
      scheduledAt: "",
      notes: "",
      consent: true,
      walkIn: admin && defaultWalkIn,
    },
  });
  const walkIn = admin && form.watch("walkIn");
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
  const scheduledAt = form.watch("scheduledAt");
  const savedVehicles = admin ? clients?.items.find((client) => client._id === clientId)?.vehicles : loyalty?.vehicles;
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
    form.setValue("couponId", undefined);
  }, [vehicle.plate, vehicle.type, service?._id, form]);
  useEffect(() => {
    if (!coupon || !scheduledAt) return;
    const selectedCoupon = loyalty?.coupons.find((item) => item._id === coupon);
    if (selectedCoupon && +new Date(selectedCoupon.expiresAt) < +new Date(scheduledAt))
      form.setValue("couponId", undefined);
  }, [coupon, scheduledAt, loyalty?.coupons, form]);
  const onSubmit = form.handleSubmit(async (fields) => {
    if (submitting.current) return;
    setError("");
    setGuestPhoneError("");
    let normalizedGuestPhone: string | undefined;
    if (admin && !clientId && guestPhone.trim()) {
      const parsedPhone = phoneSchema.safeParse(guestPhone);
      if (!parsedPhone.success) {
        setGuestPhoneError(parsedPhone.error.issues[0].message);
        guestPhoneInput.current?.focus();
        return;
      }
      normalizedGuestPhone = parsedPhone.data;
    }
    if (!admin && !consent) {
      setError("Leia e aceite a política de privacidade.");
      return;
    }
    if (!walkIn && (!fields.scheduledAt || +new Date(fields.scheduledAt) <= Date.now())) {
      setError("Escolha uma data e horário futuros para o agendamento.");
      return;
    }
    const estimatedCompletionAt = admin && deliveryTime ? localDateTimeToIso(deliveryDate || (walkIn ? dateNow() : date), deliveryTime) : "";
    if (admin && !walkIn && !estimatedCompletionAt) {
      setError("Informe a previsão de entrega para criar o agendamento confirmado.");
      return;
    }
    if (admin && deliveryTime && (!estimatedCompletionAt || +new Date(estimatedCompletionAt) <= Date.now() || (!walkIn && +new Date(estimatedCompletionAt) < +new Date(fields.scheduledAt!)))) {
      setError("A previsão de entrega deve ser futura e não pode ser anterior ao agendamento.");
      return;
    }
    submitting.current = true;
    try {
      const booking = {
        serviceId: fields.serviceId,
        vehicle: fields.vehicle,
        scheduledAt: fields.scheduledAt,
        notes: fields.notes,
        couponId: fields.couponId,
      };
      const input = admin
        ? {
            ...booking,
            scheduledAt: walkIn ? undefined : fields.scheduledAt,
            walkIn: !!walkIn,
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
            guestPhone: normalizedGuestPhone,
            ...(estimatedCompletionAt ? { estimatedCompletionAt } : {}),
          }
        : { ...booking, consent: fields.consent };
      await api(admin ? "/api/admin/appointments" : "/api/appointments", {
        method: "POST",
        body: JSON.stringify({ ...input, requestId: requestIdentity.current.get(input) }),
      });
      requestIdentity.current.reset();
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
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
        <h3>{admin ? walkIn ? "Veículo entrou na fila" : "Agendamento criado" : "Solicitação enviada"}</h3>
        <p>
          {admin
            ? walkIn ? "Chegada registrada. O veículo está aguardando atendimento na fila operacional." : "O horário já está confirmado. Registre a chegada quando o veículo entrar no lava-jato."
            : "Aguarde a confirmação e a previsão de entrega informadas pelo administrador. Você pode acompanhar o pedido na sua conta."}
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
      <fieldset disabled={form.formState.isSubmitting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="notice">
        {admin
          ? walkIn ? "Entrada imediata: o veículo será colocado na fila pela ordem de chegada." : "O agendamento manual será criado como confirmado."
          : "Escolha qualquer horário futuro. O administrador confirma o atendimento e informa a previsão de entrega."}
        <p>
          {admin
            ? "Para polimento, PPF ou qualquer serviço fora da tabela, escolha “Outros”, descreva o serviço e defina o valor."
            : "Escolha o serviço e solicite o horário. Serviços sem preço definido dependem de orçamento e aprovação da equipe."}
        </p>
      </div>
      {admin && (
        <div className="form-grid" style={{ marginBottom: 24 }}>
          <label className="checkbox-label full"><input type="checkbox" checked={!!walkIn} onChange={(e) => { form.setValue("walkIn", e.target.checked); form.setValue("scheduledAt", ""); setRequestedTime(""); }} /><span>Veículo já chegou · entrada sem agendamento</span></label>
          <label>
            Buscar cliente
            <input
              value={clientQuery}
              onChange={(e) => { setClientQuery(e.target.value); setClientId(""); }}
              placeholder="Nome ou e-mail"
            />
          </label>
          <label>
            Cliente cadastrado
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setGuestPhoneError("");
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
            <>
            <label>
              Nome do cliente avulso
              <input
                required
                value={guest}
                onChange={(e) => setGuest(e.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              Telefone/WhatsApp do cliente avulso
              <input ref={guestPhoneInput} type="tel" autoComplete="tel" inputMode="tel" value={guestPhone}
                onChange={(e) => { setGuestPhone(e.target.value); setGuestPhoneError(""); }}
                maxLength={25} placeholder="(86) 99999-9999"
                aria-invalid={!!guestPhoneError}
                aria-describedby={guestPhoneError ? "guest-phone-help guest-phone-error" : "guest-phone-help"} />
              <small id="guest-phone-help">Opcional. Informe DDD + 9 dígitos para celular ou DDD + 8 dígitos para telefone fixo.</small>
              {guestPhoneError && <span id="guest-phone-error" role="alert" className="form-error">{guestPhoneError}</span>}
            </label>
            </>
          )}
        </div>
      )}
      <div className="form-grid">
        {!!savedVehicles?.length && <label className="full">Usar veículo salvo<select defaultValue="" onChange={(e) => { const savedVehicle = savedVehicles[Number(e.target.value)]; if (e.target.value !== "" && savedVehicle) form.setValue("vehicle", savedVehicle, { shouldValidate: true }); }}><option value="">Informar veículo abaixo</option>{savedVehicles.map((savedVehicle, index) => <option key={`${savedVehicle.plate}-${index}`} value={index}>{savedVehicle.plate} · {savedVehicle.model}</option>)}</select></label>}
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
        {!walkIn && <DateTimePicker date={date} time={requestedTime} dateLabel="Data do agendamento" timeLabel="Horário desejado" minDate={dateNow()} required disabled={form.formState.isSubmitting}
          onDateChange={(value) => { setDate(value); form.setValue("scheduledAt", localDateTimeToIso(value, requestedTime), { shouldValidate: !!requestedTime }); }}
          onTimeChange={(value) => { setRequestedTime(value); form.setValue("scheduledAt", localDateTimeToIso(date, value), { shouldValidate: true }); }} />}
        {!walkIn && <p className="full fine-print">Horário de Fortaleza. A confirmação e a previsão de entrega dependem do administrador.</p>}
        {admin && <>
          <DateTimePicker date={deliveryDate || (walkIn ? dateNow() : date)} time={deliveryTime} dateLabel={walkIn ? "Data prevista de entrega (opcional)" : "Data prevista de entrega"} timeLabel={walkIn ? "Horário previsto de entrega (opcional)" : "Horário previsto de entrega"}
            minDate={walkIn ? dateNow() : date} required={!walkIn} disabled={form.formState.isSubmitting} onDateChange={setDeliveryDate} onTimeChange={setDeliveryTime} />
          <p className="full fine-print">{walkIn ? "Informe o horário para incluir uma previsão de entrega no acompanhamento." : "Informe a previsão de entrega para confirmar este agendamento."} Ela poderá ser atualizada depois.</p>
        </>}
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
                    new Date(c.expiresAt) > new Date() &&
                    (!scheduledAt || +new Date(c.expiresAt) >= +new Date(scheduledAt)),
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
      {(error || catalogError || errorMessages.length > 0) && (
        <div role="alert" className="alert-error">
          {error || catalogError || errorMessages.join("; ")}
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
              ? walkIn ? "Registrar chegada e entrar na fila" : "Criar agendamento"
              : "Solicitar agendamento"}
        </Button>
      </div>
      </fieldset>
    </form>
  );
}
