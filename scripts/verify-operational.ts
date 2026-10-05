import { loadEnvConfig } from "@next/env";
import { createClerkClient } from "@clerk/backend";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { Appointment, Audit, Coupon, Service, Slot, Transaction, User, connectDB } from "../src/lib/db";
import { changeAppointment, createBooking } from "../src/lib/business";
import { operationalQueue } from "../src/lib/control";
import { financeQuery, financeWorkbook } from "../src/lib/finance";
import { localDate, periodBounds } from "../src/lib/domain";
import { assertHomologationUri } from "../src/lib/operational-migration";
import { profileIsComplete } from "../src/lib/profile";
import { updateOwnProfile } from "../src/lib/profile-store";
import { serverRole } from "../src/lib/access-policy";
import { manualBookingSchema } from "../src/lib/validation";

async function main() {
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  assertHomologationUri(process.env.MONGODB_URI);
  const marker = `operational-smoke:${randomUUID()}`;
  const checks: string[] = [];
  const ownIds: mongoose.Types.ObjectId[] = [];
  let userId: mongoose.Types.ObjectId | undefined;
  const record = (name: string) => { checks.push(name); console.log(`PASS: ${name}`); };
  try {
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const accounts = await clerk.users.getUserList({ emailAddress: ["joelfilho015@gmail.com"], limit: 1 });
    const identity = accounts.data[0];
    assert(identity, "Clerk identity missing");
    const primary = identity.emailAddresses.find(email => email.id === identity.primaryEmailAddressId);
    const allowlist = (process.env.ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase());
    assert.equal(serverRole(identity.publicMetadata, primary?.emailAddress,
      primary?.verification?.status === "verified", allowlist), "admin");
    record("Clerk real: identidade administrativa reconhecida pelo servidor");
    await connectDB();
    assert.equal(mongoose.connection.name, "automotive_homologacao");
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const user = await User.create({ clerkId: marker, name: "Cliente Teste", loyaltyCount: 9 });
    userId = user._id;
    const actor = { clerkId: marker, userId: String(userId) };
    assert.equal(profileIsComplete(user), false);
    const profile = await updateOwnProfile(actor, { name: "Cliente Teste", phone: "(85) 99912-3456" });
    assert.equal(profile.complete, true);
    assert.equal(profile.phone, "5585999123456");
    record("MongoDB real: perfil próprio validado e normalizado");
    const service = await Service.findOne({ slug: "simples", active: true });
    assert(service, "Catalog missing");
    const requested = new Date(Date.now() + 5 * 86400000 + 17 * 60000);
    const times = [requested.toISOString(), new Date(+requested + 86400000).toISOString()];
    const vehicle = { plate: "TST1A23", model: "SMOKE Operacional", type: "small" as const };
    const booking = await createBooking({ serviceId: String(service._id), vehicle,
      scheduledAt: times[0], consent: true, notes: marker }, actor);
    ownIds.push(booking._id);
    assert.equal(booking.flexibleSchedule, true);
    assert.equal(booking.slotKey, undefined);
    const estimatedCompletionAt = new Date(+requested + 3600000).toISOString();
    const confirmed = await changeAppointment(String(booking._id), { action: "confirm", estimatedCompletionAt }, marker);
    assert.equal(confirmed.estimatedCompletionAt.toISOString(), estimatedCompletionAt);
    record("Horário livre: aprovação registra previsão sem reservar vaga legada");
    await assert.rejects(changeAppointment(String(booking._id), {
      action: "complete", finalPrice: 32.5, paymentMethod: "pix",
    }, marker), /pronto/);
    await changeAppointment(String(booking._id), { action: "arrive" }, marker);
    const walkIn = await createBooking(manualBookingSchema.parse({ walkIn: true,
      guestName: "SMOKE Cliente Avulso", guestPhone: "(85) 99912-3456", vehicle: { ...vehicle, plate: "TST2A23" },
      custom: { description: "SMOKE Atendimento", price: 0 }, notes: marker }), actor, true);
    ownIds.push(walkIn._id);
    const queue = await operationalQueue();
    const position = (id: unknown) => queue.items.findIndex(item => String(item._id) === String(id));
    assert(position(booking._id) >= 0 && position(booking._id) < position(walkIn._id));
    record("Fila real: chegada vence horário agendado; avulso entra imediatamente");
    await changeAppointment(String(booking._id), { action: "start" }, marker);
    await changeAppointment(String(booking._id), { action: "ready" }, marker);
    const attempts = await Promise.allSettled([1, 2].map(() => changeAppointment(String(booking._id),
      { action: "complete", finalPrice: 32.5, paymentMethod: "pix" }, marker)));
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await Transaction.countDocuments({ appointmentId: booking._id }), 1);
    const completed = await Appointment.findById(booking._id);
    assert(completed.completedAt < completed.scheduledAt);
    assert.equal((await User.findById(userId)).loyaltyCount, 0);
    const reward = await Coupon.findOne({ userId });
    assert(reward);
    record("Conclusão antecipada concorrente: um recibo e uma recompensa");
    const filter = { ...periodBounds("day", localDate(completed.completedAt)), category: "wash", paymentMethod: "pix" };
    const receipt = await Transaction.findOne({ ...financeQuery(filter), appointmentId: booking._id });
    assert.equal(receipt.amount, 32.5);
    assert.equal(receipt.vehiclePlate, vehicle.plate);
    assert(await Transaction.exists({ ...financeQuery({ ...periodBounds("month", localDate(completed.completedAt)),
      paymentMethod: "pix" }), appointmentId: booking._id }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await financeWorkbook(filter) as never);
    const values = JSON.stringify(workbook.worksheets.map(sheet => sheet.getSheetValues()));
    assert(values.includes(vehicle.plate) && values.includes(String(booking._id)));
    record("Financeiro real: filtros diário/mensal e Excel rastreiam o recibo");
    const couponBooking = await createBooking({ serviceId: String(service._id), vehicle,
      scheduledAt: times[1], couponId: String(reward._id), consent: true, notes: marker }, actor);
    ownIds.push(couponBooking._id);
    await changeAppointment(String(couponBooking._id), { action: "cancel", reason: marker }, marker);
    assert.equal((await Coupon.findById(reward._id)).reservedAppointmentId, undefined);
    const courtesy = await createBooking(manualBookingSchema.parse({ serviceId: String(service._id),
      vehicle, userId: String(userId), walkIn: true, couponId: String(reward._id), notes: marker }), actor, true);
    ownIds.push(courtesy._id);
    await changeAppointment(String(courtesy._id), { action: "start" }, marker);
    await changeAppointment(String(courtesy._id), { action: "ready" }, marker);
    await changeAppointment(String(courtesy._id), { action: "complete", finalPrice: 32.5, paymentMethod: "cash" }, marker);
    assert.equal((await Transaction.findOne({ appointmentId: courtesy._id })).amount, 0);
    assert.equal((await User.findById(userId)).loyaltyCount, 0);
    record("Cupom real: cancelamento libera reserva; cortesia não soma pontos");
    const rollbackBooking = await createBooking(manualBookingSchema.parse({ serviceId: String(service._id),
      vehicle: { ...vehicle, plate: "TST3A23" }, userId: String(userId), walkIn: true, notes: marker }), actor, true);
    ownIds.push(rollbackBooking._id);
    await changeAppointment(String(rollbackBooking._id), { action: "start" }, marker);
    await changeAppointment(String(rollbackBooking._id), { action: "ready" }, marker);
    await Transaction.create({ appointmentId: rollbackBooking._id, source: "appointment", date: new Date(),
      amount: 1, description: marker, paymentMethod: "pix", userId, notes: marker });
    await assert.rejects(changeAppointment(String(rollbackBooking._id), {
      action: "complete", finalPrice: 30, paymentMethod: "pix",
    }, marker));
    assert.equal((await Appointment.findById(rollbackBooking._id)).status, "ready");
    assert.equal((await User.findById(userId)).loyaltyCount, 0);
    assert.equal(await Audit.countDocuments({ appointmentId: rollbackBooking._id, action: "complete" }), 0);
    record("Rollback real: falha financeira reverte etapa, pontos e auditoria");
    await changeAppointment(String(booking._id), { action: "deliver" }, marker);
    assert.equal((await operationalQueue()).items.some(item => String(item._id) === String(booking._id)), false);
    record("Entrega real: veículo sai da fila física");
  } finally {
    if (userId && mongoose.connection.readyState === 1) {
      await mongoose.connection.transaction(async session => {
        const appointments = await Appointment.find({ _id: { $in: ownIds }, notes: marker }).session(session);
        for (const appointment of appointments) {
          if (appointment.slotKey && !appointment.flexibleSchedule && !appointment.walkIn && !appointment.slotReleasedAt) {
            const released = await Slot.updateOne({ key: appointment.slotKey, used: { $gt: 0 } },
              { $inc: { used: -1 } }, { session });
            assert.equal(released.modifiedCount, 1);
          }
        }
        await Transaction.deleteMany({ $or: [{ appointmentId: { $in: ownIds } }, { userId }] }, { session });
        await Coupon.deleteMany({ userId }, { session });
        await Audit.deleteMany({ $or: [{ appointmentId: { $in: ownIds } }, { userId }] }, { session });
        await Appointment.deleteMany({ _id: { $in: ownIds }, notes: marker }, { session });
        await User.deleteOne({ _id: userId, clerkId: marker }, { session });
      });
      assert.equal(await Appointment.countDocuments({ notes: marker }), 0);
      assert.equal(await User.countDocuments({ clerkId: marker }), 0);
      record("Limpeza: somente documentos e reservas identificados deste teste removidos");
    }
    await mongoose.disconnect();
    const folder = path.resolve("../evidencias/revisao-operacional");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "smoke.json"), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2));
  }
}
void main().catch(() => {
  console.error("FAIL: smoke operacional incompleto. Revise os checks aprovados e a conexão local; detalhes sensíveis foram omitidos.");
  process.exitCode = 1;
});
