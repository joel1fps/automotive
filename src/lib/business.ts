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
import {
  assert,
  couponMatches,
  expiryForReward,
  localSlots,
  loyaltyStep,
  validAppointmentTime,
  appointmentSlot,
} from "./domain";
import type { z } from "zod";
import type {
  actionSchema,
  bookingSchema,
  manualBookingSchema,
  settingsSchema,
} from "./validation";
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
  return Settings.findOneAndUpdate(
    { key: "main" },
    { $setOnInsert: defaultSettings },
    { upsert: true, returnDocument: "after" },
  ).lean();
}
export async function updateSettings(input: z.infer<typeof settingsSchema>) {
  await getSettings();
  return mongoose.connection.transaction(async (session) => {
    const current = await lockSettings(session);
    if (scheduleChanged(current, input)) {
      const reserved = await Appointment.exists({
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
  await Service.bulkWrite(initialServices.map(service => ({ updateOne: { filter: { slug: service.slug }, update: { $setOnInsert: service }, upsert: true } })));
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
  const settings = await getSettings();
  const date = new Date(input.scheduledAt);
  assert(
    validAppointmentTime(date, settings),
    "Escolha um horário futuro dentro do expediente.",
  );
  const userId = admin
    ? "userId" in input
      ? input.userId
      : undefined
    : actor.userId;
  assert(admin || userId, "Cliente não encontrado", 401);
  const reservedTime = appointmentSlot(date, settings)!;
  await prepareSlot(reservedTime);
  return mongoose.connection.transaction(async (session) => {
    const currentSettings = await lockSettings(session);
    assert(
      !scheduleChanged(settings, currentSettings),
      "A agenda foi alterada. Atualize os horários e tente novamente.",
      409,
    );
    assert(validAppointmentTime(date, currentSettings), "Escolha um horário futuro dentro do expediente.");
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
    await takeSlot(reservedTime, currentSettings.capacityPerSlot, session);
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
          vehicle: input.vehicle,
          serviceId: service?._id,
          serviceName: custom ? `Outros: ${custom.description}` : service.name,
          customDescription: custom?.description,
          serviceCategory: custom ? "extra" : service.category,
          countsForLoyalty: custom ? false : service.countsForLoyalty,
          scheduledAt: date,
          slotKey: reservedTime.toISOString(),
          quotedPrice: custom
            ? custom.price
            : input.couponId
              ? 0
              : service.prices?.[input.vehicle.type] ?? null,
          status: admin ? "confirmed" : "pending",
          createdBy: admin ? "admin" : "client",
          couponId: input.couponId,
          notes: input.notes,
        },
      ],
      { session },
    );
    if (customer) {
      await User.updateOne(
        { _id: userId },
        {
          $addToSet: { vehicles: input.vehicle },
          ...(!admin ? { $set: { consentAt: new Date() } } : {}),
        },
        { session },
      );
    }
    return appointment.toObject();
  });
}
export async function changeAppointment(
  id: string,
  input: z.infer<typeof actionSchema>,
  adminClerkId: string,
) {
  const settings = await getSettings();
  if (input.action === "reschedule") {
    assert(
      validAppointmentTime(new Date(input.scheduledAt), settings),
      "Horário inválido",
    );
    await prepareSlot(appointmentSlot(new Date(input.scheduledAt), settings)!);
  }
  return mongoose.connection.transaction(async (session) => {
    let currentSettings = settings;
    if (input.action === "reschedule") {
      currentSettings = await lockSettings(session);
      assert(
        !scheduleChanged(settings, currentSettings),
        "A agenda foi alterada. Atualize os horários e tente novamente.",
        409,
      );
      assert(validAppointmentTime(new Date(input.scheduledAt), currentSettings), "Horário inválido");
    }
    const appointment = await Appointment.findById(id).session(session);
    assert(appointment, "Agendamento não encontrado", 404);
    assert(
      ["pending", "confirmed", "arrived", "in_progress", "ready", "completed"].includes(appointment.status),
      "Agendamento já encerrado; ação não pode ser repetida.",
      409,
    );
    const transitions = { arrive: ["confirmed", "arrived", "arrivedAt"], start: ["arrived", "in_progress", "startedAt"], ready: ["in_progress", "ready", "readyAt"], deliver: ["completed", "delivered", "deliveredAt"] } as const;
    if (input.action in transitions) {
      const [from, to, timestamp] = transitions[input.action as keyof typeof transitions];
      assert(appointment.status === from, "Etapa inválida para este agendamento", 409);
      appointment.status = to; appointment.set(timestamp, new Date());
    }
    if (["reject", "cancel", "reschedule"].includes(input.action)) assert(["pending", "confirmed"].includes(appointment.status), "Só é possível cancelar ou reagendar antes da chegada", 409);
    if (input.action === "confirm") {
      assert(appointment.status === "pending", "Já confirmado", 409);
      appointment.status = "confirmed";
    }
    if (input.action === "reject" || input.action === "cancel") {
      appointment.status = input.action === "reject" ? "rejected" : "cancelled";
      appointment.rejectionReason = input.reason || "";
      await releaseSlot(new Date(appointment.slotKey || appointment.scheduledAt), session);
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
      const reservedTime = appointmentSlot(date, settings)!;
      const previous = new Date(appointment.slotKey || appointment.scheduledAt);
      if (+reservedTime !== +previous) {
        await takeSlot(reservedTime, currentSettings.capacityPerSlot, session);
        await releaseSlot(previous, session);
      }
      appointment.slotKey = reservedTime.toISOString();
      appointment.scheduledAt = date;
    }
    if (input.action === "complete") {
      assert(
        ["confirmed", "ready"].includes(appointment.status),
        "Marque como pronto antes de concluir",
      );
      assert(
        appointment.scheduledAt <= new Date(),
        "Não é possível concluir um serviço antes do horário agendado",
      );
      const now = new Date();
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
      if (customer && appointment.countsForLoyalty) {
        const eligible = !appointment.couponId;
        const step = loyaltyStep(customer.loyaltyCount, eligible);
        customer.loyaltyCount = step.count;
        customer.totalWashes += 1;
        await customer.save({ session });
        if (step.issue)
          await Coupon.create(
            [
              {
                userId: customer._id,
                vehiclePlate: appointment.vehicle.plate,
                vehicleType: appointment.vehicle.type,
                issuedAt: now,
                expiresAt: expiryForReward(now),
                issueKey: `appointment:${appointment._id}`,
              },
            ],
            { session },
          );
      }
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
    }
    await appointment.save({ session });
    return appointment.toObject();
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
