import mongoose, { type ClientSession } from "mongoose";
import {
  Appointment,
  Audit,
  Coupon,
  Service,
  Settings,
  Slot,
  Transaction,
  User,
  connectDB,
} from "./db";
import { defaultSettings, initialServices } from "./catalog";
import { ACTIVE_APPOINTMENT_STATUSES, appointmentTransitions, canTransition, type TransitionAction } from "./appointment-state";
import { clientBookingPolicy } from "./booking-policy";
import { profileIsComplete } from "./profile";
import { replaySubmission, runSubmission } from "./submissions";
import { creditPaidWash } from "./financial-operations";
import {
  assert,
  couponMatches,
  localSlots,
  validAppointmentTime,
  validRequestedTime,
  appointmentSlot,
} from "./domain";
import { z } from "zod";
import type {
  bookingSchema,
  manualBookingSchema,
  settingsSchema,
} from "./validation";
import { actionSchema, objectId } from "./validation";
type ScheduleSettings = Pick<
  z.infer<typeof settingsSchema>,
  "openingDays" | "openTime" | "closeTime" | "slotDuration"
>;
function scheduleChanged(before: ScheduleSettings, after: ScheduleSettings) {
  const days = (values: number[]) => [...new Set(values)].sort().join(",");
  return (
    before.openTime !== after.openTime ||
    before.closeTime !== after.closeTime ||
    before.slotDuration !== after.slotDuration ||
    days(before.openingDays) !== days(after.openingDays)
  );
}
async function lockSettings(session: ClientSession) {
  // A shared write makes settings changes conflict with concurrent reservations.
  const settings = await Settings.findOneAndUpdate(
    { key: "main" },
    { $inc: { __v: 1 } },
    { session, returnDocument: "after" },
  ).lean();
  assert(settings, "Configuração da agenda não encontrada", 409);
  return settings;
}
export async function getSettings() {
  await connectDB();
  const existing = await Settings.findOne({ key: "main" }).lean();
  if (existing) return existing;
  try {
    return await Settings.findOneAndUpdate(
      { key: "main" },
      { $setOnInsert: defaultSettings },
      { upsert: true, returnDocument: "after" },
    ).lean();
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
    // A concurrent cold start may have inserted the unique settings record.
    const initialized = await Settings.findOne({ key: "main" }).lean();
    if (!initialized) throw error;
    return initialized;
  }
}
export async function updateSettings(input: z.infer<typeof settingsSchema>) {
  await getSettings();
  return mongoose.connection.transaction(async (session) => {
    const current = await lockSettings(session);
    if (scheduleChanged(current, input)) {
      const reserved = await Appointment.exists({
        deletedAt: { $exists: false },
        flexibleSchedule: { $ne: true },
        walkIn: { $ne: true },
        scheduledAt: { $gt: new Date() },
        status: { $in: ["pending", "confirmed", "arrived", "in_progress", "ready"] },
      }).session(session);
      assert(
        !reserved,
        "Existem agendamentos futuros ativos. Cancele ou conclua essas reservas antes de alterar os dias, horários ou a duração da agenda.",
        409,
      );
    }
    return Settings.findOneAndUpdate(
      { key: "main" },
      { $set: input },
      { session, returnDocument: "after" },
    ).lean();
  });
}
export async function seedCatalog() {
  await connectDB();
  const slugs = initialServices.map(service => service.slug);
  const existing = await Service.find({ slug: { $in: slugs } }).select("slug").lean();
  const present = new Set(existing.map(service => service.slug));
  const missing = initialServices.filter(service => !present.has(service.slug));
  if (missing.length) {
    try {
      await Service.bulkWrite(missing.map(service => ({ updateOne: { filter: { slug: service.slug }, update: { $setOnInsert: service }, upsert: true } })));
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
      // Concurrent catalog initialization is safe only when every requested slug now exists.
      if (await Service.countDocuments({ slug: { $in: missing.map(service => service.slug) } }) !== missing.length) throw error;
    }
  }
  await getSettings();
}
async function prepareSlot(date: Date) {
  try {
    await Slot.updateOne(
      { key: date.toISOString() },
      { $setOnInsert: { used: 0, blocked: false } },
      { upsert: true },
    );
  } catch (error) {
    // Another request may have initialized this same slot between read and upsert.
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== 11000
    )
      throw error;
  }
}
async function takeSlot(date: Date, capacity: number, session: ClientSession) {
  const taken = await Slot.findOneAndUpdate(
    {
      key: date.toISOString(),
      blocked: false,
      $expr: { $lt: ["$used", { $ifNull: ["$capacity", capacity] }] },
    },
    { $inc: { used: 1 } },
    { session, returnDocument: "after" },
  );
  assert(
    taken,
    "Esse horário acabou de ser ocupado ou foi bloqueado. Escolha outro.",
    409,
  );
}
async function releaseSlot(date: Date, session: ClientSession) {
  const released = await Slot.updateOne(
    { key: date.toISOString(), used: { $gt: 0 } },
    { $inc: { used: -1 } },
    { session },
  );
  assert(
    released.modifiedCount === 1,
    "Reserva inconsistente. Revise o horário.",
    409,
  );
}
async function releaseAppointmentSlot(appointment: mongoose.Document & Record<string, any>, settings: ScheduleSettings, session: ClientSession, now: Date) {
  if (appointment.walkIn || appointment.flexibleSchedule || appointment.slotReleasedAt) return;
  const reserved = appointment.slotKey
    ? new Date(appointment.slotKey)
    : appointmentSlot(appointment.scheduledAt, settings) || appointment.scheduledAt;
  await releaseSlot(reserved, session);
  appointment.slotReleasedAt = now;
}
export async function availableSlots(date: string) {
  const settings = await getSettings();
  const times = localSlots(date, settings);
  const occupied = await Slot.find({
    key: { $in: times.map((t) => t.toISOString()) },
  }).lean();
  return times
    .filter((t) => t > new Date())
    .map((t) => {
      const slot = occupied.find((s) => s.key === t.toISOString());
      return {
        scheduledAt: t.toISOString(),
        available:
          !slot?.blocked &&
          (slot?.used || 0) < (slot?.capacity || settings.capacityPerSlot),
        remaining: slot?.blocked
          ? 0
          : Math.max(
              0,
              (slot?.capacity || settings.capacityPerSlot) - (slot?.used || 0),
            ),
      };
    });
}
type Booking =
  z.infer<typeof bookingSchema> | z.infer<typeof manualBookingSchema>;
export async function createBooking(
  input: Booking,
  actor: { clerkId: string; userId?: string },
  admin = false,
) {
  await getSettings();
  const repeated = await replaySubmission("booking", actor.clerkId, input.requestId, input, "Appointment");
  if (repeated) return repeated;
  const walkIn = admin && "walkIn" in input && input.walkIn === true;
  const date = walkIn ? new Date() : new Date(input.scheduledAt || "");
  const policy = clientBookingPolicy();
  assert(
    walkIn || validRequestedTime(date),
    "Escolha uma data e horário futuros para o atendimento.",
  );
  assert(admin || !policy.advanceDays || +date <= Date.now() + policy.advanceDays * 86400000,
    `Agende com até ${policy.advanceDays} dias de antecedência.`);
  const estimate = admin && "estimatedCompletionAt" in input && input.estimatedCompletionAt
    ? new Date(input.estimatedCompletionAt) : undefined;
  assert(!admin || walkIn || estimate, "Informe a previsão de entrega para confirmar o agendamento manual.");
  assert(!estimate || (validRequestedTime(estimate) && +estimate >= +date),
    "A previsão de entrega deve ser futura e igual ou posterior ao horário do atendimento.");
  const userId = admin
    ? "userId" in input
      ? input.userId
      : undefined
    : actor.userId;
  assert(admin || userId, "Cliente não encontrado", 401);
  return runSubmission("booking", actor.clerkId, input.requestId, input, "Appointment", async (session) => {
    // Every insertion conflicts on the same record, keeping the client limit atomic.
    await lockSettings(session);
    assert(walkIn || validRequestedTime(date), "Escolha uma data e horário futuros para o atendimento.");
    assert(!estimate || (validRequestedTime(estimate) && +estimate >= +date),
      "A previsão de entrega deve ser futura e igual ou posterior ao horário do atendimento.");
    if (!admin && policy.activeLimit) {
      const activeCount = await Appointment.countDocuments({ userId, deletedAt: { $exists: false }, status: { $in: ACTIVE_APPOINTMENT_STATUSES } }).session(session);
      assert(activeCount < policy.activeLimit, `Você já possui ${policy.activeLimit} agendamentos ativos. Aguarde a conclusão de um atendimento.`, 409);
    }
    const custom = admin && "custom" in input ? input.custom : undefined;
    assert(
      !custom || !input.couponId,
      "Cupom não vale para serviço à parte",
    );
    const service = custom
      ? null
      : await Service.findOne({
          _id: input.serviceId,
          active: true,
        }).session(session);
    assert(custom || service, "Serviço indisponível", 404);
    assert(!service?.vehicleTypes?.length || service.vehicleTypes.includes(input.vehicle.type), "Serviço incompatível com o veículo");
    const customer = userId
      ? await User.findById(userId).session(session)
      : null;
    assert(!userId || customer, "Cliente não encontrado", 404);
    assert(admin || profileIsComplete(customer), "Complete seu nome e telefone/WhatsApp em Meu perfil antes de agendar.", 409);
    const id = new mongoose.Types.ObjectId();
    if (input.couponId) {
      assert(userId, "Cupom precisa de cliente cadastrado");
      assert(
        service?.slug === "simples",
        "Cupom válido somente para Lavagem Simples",
      );
      const coupon = await Coupon.findOneAndUpdate(
        {
          _id: input.couponId,
          userId,
          status: "available",
          reservedAppointmentId: { $exists: false },
          expiresAt: { $gte: date },
        },
        { $set: { reservedAppointmentId: id } },
        { session, returnDocument: "after" },
      );
      assert(
        coupon && couponMatches(coupon, input.vehicle, date),
        "Cupom vencido, reservado ou incompatível com a placa/tamanho do veículo.",
        409,
      );
    }
    const [appointment] = await Appointment.create(
      [
        {
          _id: id,
          userId,
          guestName: "guestName" in input ? input.guestName : undefined,
          guestPhone: "guestPhone" in input ? input.guestPhone || undefined : undefined,
          vehicle: input.vehicle,
          serviceId: service?._id,
          serviceName: custom ? `Outros: ${custom.description}` : service.name,
          customDescription: custom?.description,
          serviceCategory: custom ? "extra" : service.category,
          countsForLoyalty: custom ? false : service.countsForLoyalty,
          scheduledAt: date,
          walkIn,
          flexibleSchedule: true,
          estimatedCompletionAt: estimate,
          quotedPrice: custom
            ? custom.price
            : input.couponId
              ? 0
              : service.prices?.[input.vehicle.type] ?? null,
          status: walkIn ? "arrived" : admin ? "confirmed" : "pending",
          confirmedAt: admin ? new Date() : undefined,
          arrivedAt: walkIn ? date : undefined,
          createdBy: admin ? "admin" : "client",
          couponId: input.couponId,
          notes: input.notes,
        },
      ],
      { session },
    );
    if (customer) {
      // A plate identifies a saved vehicle. Bound this convenience list even when
      // vehicles arrive through bookings rather than the profile's validated form.
      customer.vehicles = [...customer.vehicles.filter((saved: {plate: string}) => saved.plate !== input.vehicle.plate), input.vehicle].slice(-20);
      if (!admin) customer.consentAt = new Date();
      await customer.save({ session });
    }
    await Audit.create([{ adminClerkId: admin ? actor.clerkId : undefined, userId, appointmentId: id,
      action: walkIn ? "walk_in" : "booking_created", toStatus: appointment.status,
      scheduledAfter: date, estimatedCompletionAfter: estimate }], { session });
    return appointment.toObject();
  });
}
export async function changeAppointment(
  id: string,
  input: z.infer<typeof actionSchema>,
  adminClerkId: string,
) {
  input = actionSchema.parse(input);
  const settings = await getSettings();
  if (input.action === "reschedule") {
    const existing = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } }).select("flexibleSchedule").lean();
    assert(existing, "Agendamento não encontrado", 404);
    assert(validRequestedTime(new Date(input.scheduledAt)), "Escolha uma data e horário futuros para o atendimento.");
    if (!existing.flexibleSchedule) {
      assert(validAppointmentTime(new Date(input.scheduledAt), settings), "Horário inválido para a reserva antiga");
      await prepareSlot(appointmentSlot(new Date(input.scheduledAt), settings)!);
    }
  }
  return mongoose.connection.transaction(async (session) => {
    const appointment = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } }).session(session);
    assert(appointment, "Agendamento não encontrado", 404);
    let currentSettings = settings;
    if (input.action === "reschedule" && !appointment.flexibleSchedule) {
      currentSettings = await lockSettings(session);
      assert(
        !scheduleChanged(settings, currentSettings),
        "A agenda foi alterada. Atualize os horários e tente novamente.",
        409,
      );
      assert(validAppointmentTime(new Date(input.scheduledAt), currentSettings), "Horário inválido");
    }
    const fromStatus = appointment.status;
    const scheduledBefore = appointment.scheduledAt;
    const estimatedCompletionBefore = appointment.estimatedCompletionAt;
    const now = new Date();
    if (input.action === "reschedule") {
      assert(["pending", "confirmed"].includes(appointment.status), "Só é possível reagendar antes da chegada", 409);
      assert(validRequestedTime(new Date(input.scheduledAt), now), "Escolha uma data e horário futuros para o atendimento.");
    } else {
      const transition = appointmentTransitions[input.action as TransitionAction];
      assert(transition && canTransition(appointment.status, input.action as TransitionAction),
        input.action === "complete" ? "Marque como pronto antes de concluir. Este pagamento já pode ter sido registrado." : "Etapa inválida para este agendamento; a ação pode já ter sido aplicada.", 409);
      appointment.status = transition.to;
      appointment.set(transition.timestamp, now);
    }
    if (input.action === "confirm") {
      const estimate = new Date(input.estimatedCompletionAt);
      assert(validRequestedTime(estimate, now) && +estimate >= +appointment.scheduledAt,
        "A previsão de entrega deve ser futura e igual ou posterior ao horário do atendimento.");
      appointment.estimatedCompletionAt = estimate;
    }
    if (input.action === "return") {
      assert(!await Transaction.exists({ appointmentId: appointment._id }).session(session), "Este atendimento possui pagamento. Corrija o financeiro e registre a entrega, preservando o fechamento.", 409);
      appointment.returnReason = input.reason;
      await releaseAppointmentSlot(appointment, currentSettings, session, now);
      if (appointment.couponId) await Coupon.updateOne({ _id: appointment.couponId, status: "available", reservedAppointmentId: appointment._id },
        { $unset: { reservedAppointmentId: 1 } }, { session });
    }
    if (input.action === "reject" || input.action === "cancel") {
      appointment.rejectionReason = input.reason || "";
      await releaseAppointmentSlot(appointment, currentSettings, session, now);
      if (appointment.couponId)
        await Coupon.updateOne(
          { _id: appointment.couponId, reservedAppointmentId: appointment._id },
          { $unset: { reservedAppointmentId: 1 } },
          { session },
        );
    }
    if (input.action === "reschedule") {
      const date = new Date(input.scheduledAt);
      assert(+date !== +appointment.scheduledAt, "Selecione outro horário");
      if (appointment.couponId) {
        const coupon = await Coupon.findById(appointment.couponId).session(
          session,
        );
        assert(
          coupon && coupon.expiresAt >= date,
          "O cupom vence antes desse horário",
        );
      }
      const estimate = input.estimatedCompletionAt ? new Date(input.estimatedCompletionAt) : appointment.estimatedCompletionAt;
      assert(!input.estimatedCompletionAt || (validRequestedTime(estimate, now) && +estimate >= +date),
        "A previsão de entrega deve ser futura e igual ou posterior ao novo horário.");
      assert(appointment.status !== "confirmed" || (estimate && validRequestedTime(estimate, now) && +estimate >= +date),
        "Informe uma nova previsão de entrega para reagendar este atendimento aprovado.");
      if (!appointment.flexibleSchedule) {
        const reservedTime = appointmentSlot(date, currentSettings)!;
        const previous = appointment.slotKey ? new Date(appointment.slotKey) : appointmentSlot(appointment.scheduledAt, currentSettings) || appointment.scheduledAt;
        if (+reservedTime !== +previous) {
          await takeSlot(reservedTime, currentSettings.capacityPerSlot, session);
          await releaseSlot(previous, session);
        }
        appointment.slotKey = reservedTime.toISOString();
      }
      appointment.scheduledAt = date;
      if (input.estimatedCompletionAt) appointment.estimatedCompletionAt = estimate;
    }
    if (input.action === "complete") {
      const value = appointment.couponId ? 0 : input.finalPrice;
      if (appointment.couponId) {
        const used = await Coupon.updateOne(
          {
            _id: appointment.couponId,
            userId: appointment.userId,
            status: "available",
            reservedAppointmentId: appointment._id,
          },
          {
            $set: {
              status: "used",
              usedAt: now,
              usedInAppointmentId: appointment._id,
            },
            $unset: { reservedAppointmentId: 1 },
          },
          { session },
        );
        assert(
          used.modifiedCount === 1,
          "Cupom já utilizado ou não reservado por este agendamento",
          409,
        );
      }
      const customer = appointment.userId
        ? await User.findById(appointment.userId).session(session)
        : null;
      if (customer && appointment.countsForLoyalty && !appointment.couponId && value > 0) {
        await creditPaidWash(customer, appointment, session, now);
      }
      appointment.loyaltyFinancialPositive = Boolean(customer && appointment.countsForLoyalty && !appointment.couponId && value > 0);
      await Transaction.create(
        [
          {
            date: now,
            description: appointment.couponId
              ? `${appointment.serviceName} — cortesia fidelidade`
              : appointment.serviceName,
            category: appointment.serviceCategory,
            source: "appointment",
            appointmentId: appointment._id,
            userId: appointment.userId,
            clientName: customer?.name || appointment.guestName || "Cliente",
            vehiclePlate: appointment.vehicle.plate,
            vehicleModel: appointment.vehicle.model,
            serviceName: appointment.serviceName,
            amount: value,
            paymentMethod: input.paymentMethod,
            createdBy: adminClerkId,
          },
        ],
        { session },
      );
      appointment.status = "completed";
      appointment.completedAt = now;
      appointment.finalPrice = value;
      appointment.paymentMethod = input.paymentMethod;
      await releaseAppointmentSlot(appointment, currentSettings, session, now);
    }
    await appointment.save({ session });
    await Audit.create([{adminClerkId, userId: appointment.userId, appointmentId: appointment._id,
      action: input.action, reason: "reason" in input ? input.reason : undefined,
      fromStatus, toStatus: appointment.status, scheduledBefore, scheduledAfter: appointment.scheduledAt,
      estimatedCompletionBefore, estimatedCompletionAfter: appointment.estimatedCompletionAt}], {session});
    return appointment.toObject();
  });
}
export const deleteAppointmentSchema = z.object({
  reason: z.string({ error: "Informe o motivo da exclusão." }).trim()
    .min(5, "Descreva o motivo da exclusão com pelo menos 5 caracteres.")
    .max(500, "O motivo da exclusão deve ter no máximo 500 caracteres."),
}).strict();

export type AppointmentDeletion = {
  id: string;
  deleted: true;
  deletedAt: string;
  alreadyDeleted: boolean;
};

// Called only after the API has verified the administrator against Clerk.
// The appointment remains available to financial reports and its audit history.
export async function deleteAppointment(id: string, input: unknown, adminClerkId: string): Promise<AppointmentDeletion> {
  objectId.parse(id);
  const parsed = deleteAppointmentSchema.parse(input);
  assert(typeof adminClerkId === "string" && adminClerkId.trim(), "Administrador não identificado", 403);
  await getSettings();
  return mongoose.connection.transaction(async session => {
    const appointment = await Appointment.findById(id).select("+trackingToken +trackingTokenHash").session(session);
    assert(appointment, "Agendamento não encontrado", 404);
    if (appointment.deletedAt) return {
      id, deleted: true, deletedAt: appointment.deletedAt.toISOString(), alreadyDeleted: true,
    };
    assert(!["arrived", "in_progress", "ready", "completed"].includes(appointment.status),
      "O veículo ainda está no lava-jato. Registre a entrega ou a devolução antes de excluir o cadastro.", 409);
    // Serialize against reservations, settings changes, and client booking limits.
    const settings = await lockSettings(session);
    const now = new Date();
    if (["completed", "delivered", "cancelled", "rejected", "returned"].includes(appointment.status)) {
      // Legacy terminal appointments may lack this marker, but their capacity
      // was already released. Never decrement a different reservation's counter.
      if (!appointment.walkIn && !appointment.flexibleSchedule && !appointment.slotReleasedAt) appointment.slotReleasedAt = now;
    } else {
      await releaseAppointmentSlot(appointment, settings, session, now);
    }
    if (appointment.couponId) await Coupon.updateOne({
      _id: appointment.couponId, status: "available", reservedAppointmentId: appointment._id,
    }, { $unset: { reservedAppointmentId: 1 } }, { session });

    const customer = appointment.userId ? await User.findById(appointment.userId).select("name").session(session).lean() : null;
    const receipt = await Transaction.exists({ appointmentId: appointment._id }).session(session);
    appointment.deletedAt = now;
    appointment.deletedBy = adminClerkId;
    appointment.deletionReason = parsed.reason;
    appointment.trackingToken = undefined;
    appointment.trackingTokenHash = undefined;
    appointment.trackingRevokedAt = now;
    await appointment.save({ session });
    await Audit.create([{
      adminClerkId, userId: appointment.userId, appointmentId: appointment._id,
      action: "appointment_deleted", reason: parsed.reason,
      fromStatus: appointment.status, toStatus: appointment.status,
      scheduledBefore: appointment.scheduledAt, scheduledAfter: appointment.scheduledAt,
      details: {
        clientName: customer?.name || appointment.guestName || "Cliente",
        serviceName: appointment.serviceName || appointment.customDescription || "Serviço automotivo",
        vehicle: { model: appointment.vehicle?.model, plate: appointment.vehicle?.plate, type: appointment.vehicle?.type },
        scheduledAt: appointment.scheduledAt,
        quotedPrice: appointment.quotedPrice, finalPrice: appointment.finalPrice,
        paymentMethod: appointment.paymentMethod, walkIn: Boolean(appointment.walkIn),
        financialPreserved: Boolean(receipt),
      },
    }], { session });
    return { id, deleted: true, deletedAt: now.toISOString(), alreadyDeleted: false };
  });
}

export async function adjustPoints(
  userId: string,
  delta: number,
  reason: string,
  actor: string,
) {
  await connectDB();
  return mongoose.connection.transaction(async (session) => {
    const user = await User.findById(userId).session(session);
    assert(user, "Cliente não encontrado", 404);
    const after = user.loyaltyCount + delta;
    assert(
      after >= 0 && after <= 9,
      "O ajuste deve manter o ciclo entre 0 e 9. Cupons são emitidos ao concluir lavagens.",
    );
    await Audit.create(
      [
        {
          adminClerkId: actor,
          userId,
          action: "loyalty_adjustment",
          reason,
          before: user.loyaltyCount,
          after,
        },
      ],
      { session },
    );
    user.loyaltyCount = after;
    await user.save({ session });
    return user.toObject();
  });
}
