import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { addDays } from "date-fns";
import { Appointment, Audit, Coupon, Service, Settings, Slot, Transaction, User, connectDB } from "../src/lib/db";
import { changeAppointment, createBooking, deleteAppointment, deleteAppointmentSchema, getSettings, seedCatalog, updateSettings } from "../src/lib/business";
import { expiryForReward, localDate, localSlots, periodBounds } from "../src/lib/domain";
import { controlSummary, operationalQueue } from "../src/lib/control";
import { financeSummary, financeWorkbook, financeXml } from "../src/lib/finance";
import { generateTracking, readAdminTracking, readPublicTracking, revokeTracking, updateTrackingEstimate } from "../src/lib/tracking";
import { settingsSchema } from "../src/lib/validation";
import ExcelJS from "exceljs";

let server: MongoMemoryReplSet;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = server.getUri("deletion_test");
  await connectDB();
  await seedCatalog();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}, { timeout: 240000 });
afterEach(async () => {
  // All data below belongs to this test process's private in-memory replica set.
  await Promise.all([Appointment, Audit, Coupon, Slot, Transaction, User].map(model => model.deleteMany({})));
});
after(async () => { await mongoose.disconnect(); await server?.stop(); });

const vehicle = { model: "Onix", plate: "DEL1A23", type: "small" as const };
const reason = { reason: "Cadastro de atendimento duplicado" };
async function fixture(points = 0, useCoupon = false) {
  const user = await User.create({
    clerkId: `delete-client-${new mongoose.Types.ObjectId()}`, name: "Cliente da exclusão",
    phone: "5585999991234", email: "privado@example.com", loyaltyCount: points,
  });
  const service = await Service.findOne({ slug: "simples" });
  const settings = await getSettings();
  let date = addDays(new Date(), 4);
  while (!localSlots(localDate(date), settings).length) date = addDays(date, 1);
  const slots = localSlots(localDate(date), settings);
  const coupon = useCoupon ? await Coupon.create({
    userId: user._id, vehiclePlate: vehicle.plate, vehicleType: vehicle.type,
    issuedAt: new Date(), expiresAt: expiryForReward(new Date()),
    issueKey: `deletion-coupon-${new mongoose.Types.ObjectId()}`,
  }) : null;
  const booking = await createBooking({
    userId: String(user._id), serviceId: String(service._id), vehicle,
    scheduledAt: slots[0].toISOString(), estimatedCompletionAt: new Date(+slots[0] + 3600000).toISOString(), notes: "Observação interna não necessária ao log",
    ...(coupon ? { couponId: String(coupon._id) } : {}),
  }, { clerkId: "admin-owner" }, true);
  // A persisted legacy reservation retains its counter through the new free schedule.
  await Appointment.updateOne({ _id: booking._id }, { $set: { flexibleSchedule: false, slotKey: slots[0].toISOString() } });
  await Slot.updateOne({ key: slots[0].toISOString() }, { $inc: { used: 1 }, $setOnInsert: { blocked: false } }, { upsert: true });
  return { user, service, settings, slots, coupon, booking, id: String(booking._id) };
}
async function ready(id: string) {
  for (const action of ["arrive", "start", "ready"] as const) await changeAppointment(id, { action }, "admin-owner");
}

test("Excluir libera vaga e cupom disponível, revoga o link e cria log com identidade do administrador", async () => {
  const f = await fixture(0, true);
  const link = await generateTracking(f.id, "generate", "admin-owner");
  const token = link.url!.slice("/acompanhar/".length);
  const result = await deleteAppointment(f.id, { reason: `  ${reason.reason}  ` }, "admin-owner");
  assert.equal(result.deleted, true);
  assert.equal(result.alreadyDeleted, false);
  assert.equal(result.id, f.id);
  const deleted = await Appointment.findById(f.id).select("+trackingToken +trackingTokenHash +deletionReason").lean();
  assert.equal(deleted.status, "confirmed");
  assert.equal(deleted.deletedBy, "admin-owner");
  assert.equal(deleted.deletionReason, reason.reason);
  assert.equal(deleted.deletedAt.toISOString(), result.deletedAt);
  assert.ok(deleted.slotReleasedAt);
  assert.ok(deleted.trackingRevokedAt);
  assert.equal(deleted.trackingToken, undefined);
  assert.equal(deleted.trackingTokenHash, undefined);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
  assert.equal((await Coupon.findById(f.coupon!._id)).reservedAppointmentId, undefined);
  assert.equal((await Coupon.findById(f.coupon!._id)).status, "available");
  const log = await Audit.findOne({ action: "appointment_deleted", appointmentId: f.id }).lean();
  assert.equal(log.adminClerkId, "admin-owner");
  assert.equal(log.reason, reason.reason);
  assert.equal(String(log.userId), String(f.user._id));
  assert.equal(log.fromStatus, "confirmed");
  assert.equal(log.toStatus, "confirmed");
  assert.equal(log.details.clientName, f.user.name);
  assert.equal(log.details.vehicle.plate, vehicle.plate);
  assert.equal(log.details.serviceName, f.service.name);
  assert.equal(log.details.financialPreserved, false);
  const serialized = JSON.stringify(log);
  for (const secret of [token, "5585999991234", "privado@example.com", "Observação interna não necessária ao log", "trackingToken"])
    assert.equal(serialized.includes(secret), false);
  await assert.rejects(readPublicTracking(token), { status: 404 });
  for (const action of [
    () => readAdminTracking(f.id),
    () => generateTracking(f.id, "generate", "admin-owner"),
    () => generateTracking(f.id, "regenerate", "admin-owner"),
    () => revokeTracking(f.id, "admin-owner"),
    () => updateTrackingEstimate(f.id, { estimatedCompletionAt: null }, "admin-owner"),
    () => changeAppointment(f.id, { action: "arrive" }, "admin-owner"),
  ]) await assert.rejects(action(), { status: 404 });
  assert.equal((await controlSummary(localDate(f.booking.scheduledAt))).total, 0);
});

test("Solicitações concorrentes e repetidas não duplicam log nem liberam a mesma vaga duas vezes", async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 4 }, () => deleteAppointment(f.id, reason, "admin-owner")));
  assert.equal(results.filter(result => !result.alreadyDeleted).length, 1);
  assert.equal(new Set(results.map(result => result.deletedAt)).size, 1);
  assert.equal(await Audit.countDocuments({ action: "appointment_deleted", appointmentId: f.id }), 1);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
  const repeated = await deleteAppointment(f.id, { reason: "Outro motivo informado" }, "second-admin");
  assert.equal(repeated.alreadyDeleted, true);
  const stored = await Appointment.findById(f.id).select("+deletionReason");
  assert.equal(stored.deletedBy, "admin-owner");
  assert.equal(stored.deletionReason, reason.reason);
});

test("Excluir atendimento pago e entregue preserva financeiro, datas, pontos e recompensa nos relatórios", async () => {
  const f = await fixture(9);
  await ready(f.id);
  const paid = await changeAppointment(f.id, { action: "complete", finalPrice: 50.25, paymentMethod: "pix" }, "admin-owner");
  const delivered = await changeAppointment(f.id, { action: "deliver" }, "admin-owner");
  const receipt = await Transaction.findOne({ appointmentId: f.id }).lean();
  await deleteAppointment(f.id, reason, "admin-owner");
  assert.deepEqual(await Transaction.findOne({ appointmentId: f.id }).lean(), receipt);
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 0);
  assert.equal((await User.findById(f.user._id)).totalWashes, 1);
  assert.equal(await Coupon.countDocuments({ issueKey: `appointment:${f.id}`, status: "available" }), 1);
  const stored = await Appointment.findById(f.id);
  assert.equal(stored.status, "delivered");
  assert.equal(+stored.completedAt, +paid.completedAt);
  assert.equal(+stored.deliveredAt, +delivered.deliveredAt);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
  const filter = { ...periodBounds("day", localDate(receipt.date)) };
  assert.equal((await financeSummary(filter)).total, 50.25);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await financeWorkbook(filter) as never);
  assert.equal(book.getWorksheet("Entradas")?.getCell("F2").value, 50.25);
  assert.equal(book.getWorksheet("Entradas")?.getCell("J2").value, f.id);
  assert.notEqual(book.getWorksheet("Entradas")?.getCell("P2").value, "Não entregue");
  const xml = await financeXml(filter);
  assert.ok(xml.includes(f.id));
  assert.ok(xml.includes("50.25"));
  const exit = xml.match(/<saida>([^<]+)<\/saida>/)?.[1];
  assert.ok(exit);
  assert.equal(new Date(exit).toISOString(), delivered.deliveredAt.toISOString());
  assert.equal((await Audit.findOne({ action: "appointment_deleted", appointmentId: f.id })).details.financialPreserved, true);
});

test("Cupom usado e lavagem de cortesia permanecem registrados após exclusão", async () => {
  const f = await fixture(3, true);
  await ready(f.id);
  await changeAppointment(f.id, { action: "complete", finalPrice: 100, paymentMethod: "pix" }, "admin-owner");
  const usedBefore = await Coupon.findById(f.coupon!._id).lean();
  await assert.rejects(deleteAppointment(f.id, reason, "admin-owner"), { status: 409 });
  await changeAppointment(f.id, { action: "deliver" }, "admin-owner");
  await deleteAppointment(f.id, reason, "admin-owner");
  assert.deepEqual(await Coupon.findById(f.coupon!._id).lean(), usedBefore);
  assert.equal((await Transaction.findOne({ appointmentId: f.id })).amount, 0);
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 3);
});

test("Excluir legado encerrado sem marcador de liberação não reduz vaga de outro atendimento", async () => {
  const f = await fixture();
  for (const status of ["cancelled", "rejected", "delivered", "returned"]) {
    const legacy = await Appointment.create({ vehicle, serviceName: "Legado", scheduledAt: f.slots[0], slotKey: f.slots[0].toISOString(), status });
    await deleteAppointment(String(legacy._id), reason, "admin-owner");
    assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
    assert.ok((await Appointment.findById(legacy._id)).slotReleasedAt);
  }
  const paidOnSite = await Appointment.create({ vehicle, serviceName: "Legado pago", scheduledAt: f.slots[0], slotKey: f.slots[0].toISOString(), status: "completed" });
  await assert.rejects(deleteAppointment(String(paidOnSite._id), reason, "admin-owner"), { status: 409 });
  await changeAppointment(String(paidOnSite._id), { action: "deliver" }, "admin-owner");
  await deleteAppointment(String(paidOnSite._id), reason, "admin-owner");
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
  await deleteAppointment(f.id, reason, "admin-owner");
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
});

test("Veículo presente não pode ser excluído; entrega ou devolução libera a exclusão sem consumir vaga de encaixe", async () => {
  for (const status of ["arrived", "in_progress", "ready", "completed"]) {
    const appointment = await Appointment.create({
      vehicle, serviceName: "Encaixe", scheduledAt: new Date(), arrivedAt: new Date(), status, walkIn: true, quotedPrice: 50,
    });
    const id = String(appointment._id);
    assert.ok((await operationalQueue()).items.some(item => String(item._id) === id));
    await assert.rejects(deleteAppointment(id, reason, "admin-owner"), { status: 409 });
    assert.ok((await operationalQueue()).items.some(item => String(item._id) === id));
    assert.equal((await Appointment.findById(id)).deletedAt, undefined);
    assert.equal(await Audit.countDocuments({ appointmentId: id, action: "appointment_deleted" }), 0);
    if (status === "completed") await changeAppointment(id, { action: "deliver" }, "admin-owner");
    else await changeAppointment(id, { action: "return", reason: "Cliente retirou o veículo sem pagamento" }, "admin-owner");
    await deleteAppointment(id, reason, "admin-owner");
    assert.equal((await operationalQueue()).items.some(item => String(item._id) === id), false);
  }
  const summary = await controlSummary(localDate(new Date()));
  for (const key of ["onSite", "entered", "inProgress", "ready", "waiting", "awaitingPayment", "awaitingPickup", "physicalReceivable"] as const)
    assert.equal(summary[key], 0, key);
  assert.equal(await Slot.countDocuments(), 0);
});

test("Falha ao registrar log reverte exclusão, vaga, cupom e revogação do link", async () => {
  const f = await fixture(0, true);
  const info = await generateTracking(f.id, "generate", "admin-owner");
  const create = Audit.create;
  Audit.create = async () => { throw new Error("deletion-audit-failure"); };
  try {
    await assert.rejects(deleteAppointment(f.id, reason, "admin-owner"), /deletion-audit-failure/);
  } finally { Audit.create = create; }
  assert.equal((await Appointment.findById(f.id)).deletedAt, undefined);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
  assert.equal(String((await Coupon.findById(f.coupon!._id)).reservedAppointmentId), f.id);
  assert.equal((await readAdminTracking(f.id)).url, info.url);
  assert.equal((await readPublicTracking(info.url!.slice("/acompanhar/".length))).status, "confirmed");
  assert.equal(await Audit.countDocuments({ action: "appointment_deleted" }), 0);
});

test("Pagamento concorrente à exclusão mantém o veículo na fila até a entrega e preserva receita única", async () => {
  const f = await fixture(2);
  await ready(f.id);
  const [removed, paid] = await Promise.allSettled([
    deleteAppointment(f.id, reason, "admin-owner"),
    changeAppointment(f.id, { action: "complete", finalPrice: 50, paymentMethod: "pix" }, "admin-owner"),
  ]);
  assert.equal(removed.status, "rejected");
  if (removed.status === "rejected") assert.equal(removed.reason.status, 409);
  assert.equal(paid.status, "fulfilled");
  const receiptCount = await Transaction.countDocuments({ appointmentId: f.id });
  assert.equal(receiptCount, 1);
  const user = await User.findById(f.user._id);
  assert.equal(user.loyaltyCount, 2 + receiptCount);
  assert.equal(user.totalWashes, receiptCount);
  assert.equal((await Appointment.findById(f.id)).deletedAt, undefined);
  assert.equal((await Appointment.findById(f.id)).status, "completed");
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
  assert.equal(await Audit.countDocuments({ action: "appointment_deleted", appointmentId: f.id }), 0);
  await assert.rejects(changeAppointment(f.id, { action: "complete", finalPrice: 50, paymentMethod: "pix" }, "admin-owner"), { status: 409 });
  await changeAppointment(f.id, { action: "deliver" }, "admin-owner");
  await deleteAppointment(f.id, reason, "admin-owner");
  assert.equal(await Transaction.countDocuments({ appointmentId: f.id }), 1);
  assert.equal(await Audit.countDocuments({ action: "appointment_deleted", appointmentId: f.id }), 1);
});

test("Motivo obrigatório e campos extras não alteram nenhum registro e exclusão inexistente retorna 404", async () => {
  const f = await fixture();
  for (const input of [{}, { reason: "    " }, { reason: "abc" }, { reason: "x".repeat(501) }, { ...reason, adminClerkId: "forged" }, { reason: { $ne: null } }])
    await assert.rejects(deleteAppointment(f.id, input, "admin-owner"));
  assert.throws(() => deleteAppointmentSchema.parse({ ...reason, deletedAt: new Date().toISOString() }));
  await assert.rejects(deleteAppointment(f.id, reason, " "), { status: 403 });
  await assert.rejects(deleteAppointment(String(new mongoose.Types.ObjectId()), reason, "admin-owner"), { status: 404 });
  assert.equal((await Appointment.findById(f.id)).deletedAt, undefined);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
  assert.equal(await Audit.countDocuments({ action: "appointment_deleted" }), 0);
});

test("Excluído não bloqueia limite de agendamentos do cliente nem mudança da agenda", async () => {
  const f = await fixture();
  await deleteAppointment(f.id, reason, "admin-owner");
  const previous = process.env.MAX_CLIENT_ACTIVE_BOOKINGS;
  process.env.MAX_CLIENT_ACTIVE_BOOKINGS = "1";
  try {
    const input = settingsSchema.parse(f.settings);
    await updateSettings({ ...input, slotDuration: 30 });
    await updateSettings(input);
    const next = await createBooking({
      serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(), notes: "", consent: true,
    }, { clerkId: f.user.clerkId, userId: String(f.user._id) });
    assert.equal(next.status, "pending");
    assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
  } finally {
    if (previous === undefined) delete process.env.MAX_CLIENT_ACTIVE_BOOKINGS;
    else process.env.MAX_CLIENT_ACTIVE_BOOKINGS = previous;
  }
});

test("Excluir solicitação livre não libera o contador de um atendimento legado no mesmo horário", async () => {
  const f = await fixture();
  const request = await createBooking({ serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(), consent: true, notes: "" },
    { clerkId: f.user.clerkId, userId: String(f.user._id) });
  assert.equal(request.flexibleSchedule, true);
  assert.equal(request.slotKey, undefined);
  await deleteAppointment(String(request._id), reason, "admin-owner");
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
  assert.equal((await Appointment.findById(request._id)).slotReleasedAt, undefined);
  assert.equal(await Audit.countDocuments({ appointmentId: request._id, action: "appointment_deleted" }), 1);
});

test("Devolução em recebido, em execução e pronto preserva etapas, libera vaga e cupom sem gerar receita ou pontos", async () => {
  for (const status of ["arrived", "in_progress", "ready"]) {
    const f = await fixture(9, true);
    await changeAppointment(f.id, { action: "arrive" }, "admin-owner");
    if (status !== "arrived") await changeAppointment(f.id, { action: "start" }, "admin-owner");
    if (status === "ready") await changeAppointment(f.id, { action: "ready" }, "admin-owner");
    const before = await Appointment.findById(f.id).lean();
    const link = await generateTracking(f.id, "generate", "admin-owner");
    const returned = await changeAppointment(f.id, { action: "return", reason: "  Cliente retirou o veículo sem pagamento  " }, "second-admin");
    assert.equal(returned.status, "returned");
    assert.equal(returned.returnReason, "Cliente retirou o veículo sem pagamento");
    assert.ok(returned.returnedAt instanceof Date);
    assert.equal(+returned.slotReleasedAt, +returned.returnedAt);
    assert.equal(+returned.arrivedAt, +before.arrivedAt);
    for (const timestamp of ["startedAt", "readyAt", "estimatedCompletionAt"] as const)
      assert.equal(returned[timestamp] ? +returned[timestamp] : undefined, before[timestamp] ? +before[timestamp] : undefined, timestamp);
    assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
    const coupon = await Coupon.findById(f.coupon!._id);
    assert.equal(coupon.status, "available");
    assert.equal(coupon.reservedAppointmentId, undefined);
    const customer = await User.findById(f.user._id);
    assert.equal(customer.loyaltyCount, 9);
    assert.equal(customer.totalWashes, 0);
    assert.equal(await Transaction.countDocuments({ appointmentId: f.id }), 0);
    assert.equal(await Coupon.countDocuments({ issueKey: `appointment:${f.id}` }), 0);
    assert.equal((await operationalQueue()).items.some(item => String(item._id) === f.id), false);
    const log = await Audit.findOne({ action: "return", appointmentId: f.id }).lean();
    assert.equal(log.adminClerkId, "second-admin");
    assert.equal(log.reason, returned.returnReason);
    assert.equal(log.fromStatus, status);
    assert.equal(log.toStatus, "returned");
    const publicData = await readPublicTracking(link.url!.slice("/acompanhar/".length));
    assert.equal(publicData.status, "returned");
    assert.equal(publicData.returnedAt, returned.returnedAt.toISOString());
    assert.equal(Object.hasOwn(publicData, "returnReason"), false);
    await assert.rejects(changeAppointment(f.id, { action: "return", reason: "Tentativa repetida da devolução" }, "second-admin"), { status: 409 });
    await assert.rejects(changeAppointment(f.id, { action: "complete", finalPrice: 50, paymentMethod: "pix" }, "second-admin"), { status: 409 });
    assert.equal(await Audit.countDocuments({ action: "return", appointmentId: f.id }), 1);
    await deleteAppointment(f.id, reason, "admin-owner");
    assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
  }
});

test("Falha no log de devolução reverte estado, data, vaga e reserva do cupom", async () => {
  const f = await fixture(4, true);
  await ready(f.id);
  const before = await Appointment.findById(f.id).lean();
  const create = Audit.create;
  Audit.create = async () => { throw new Error("return-audit-failure"); };
  try {
    await assert.rejects(changeAppointment(f.id, { action: "return", reason: "Retirada antecipada pelo cliente" }, "admin-owner"), /return-audit-failure/);
  } finally { Audit.create = create; }
  const after = await Appointment.findById(f.id).lean();
  assert.equal(after.status, "ready");
  assert.equal(+after.readyAt, +before.readyAt);
  assert.equal(after.returnedAt, undefined);
  assert.equal(after.returnReason, undefined);
  assert.equal(after.slotReleasedAt, undefined);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
  assert.equal(String((await Coupon.findById(f.coupon!._id)).reservedAppointmentId), f.id);
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 4);
  assert.equal(await Transaction.countDocuments({ appointmentId: f.id }), 0);
  assert.equal(await Audit.countDocuments({ action: "return", appointmentId: f.id }), 0);
});

test("Devolução não encerra reserva sem chegada e não aceita atendimento pago ou com lançamento inconsistente", async () => {
  const f = await fixture(4);
  await assert.rejects(changeAppointment(f.id, { action: "return", reason: "Retirada antes da chegada" }, "admin-owner"), { status: 409 });
  assert.equal((await Appointment.findById(f.id)).status, "confirmed");
  await ready(f.id);
  await Transaction.create({ appointmentId: f.id, source: "appointment", description: "Pagamento legado inconsistente", amount: 50, paymentMethod: "pix", date: new Date() });
  await assert.rejects(changeAppointment(f.id, { action: "return", reason: "Tentativa de devolver atendimento já pago" }, "admin-owner"), { status: 409 });
  assert.equal((await Appointment.findById(f.id)).status, "ready");
  assert.equal((await Appointment.findById(f.id)).returnedAt, undefined);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
  assert.equal(await Audit.countDocuments({ action: "return", appointmentId: f.id }), 0);
  await Transaction.deleteOne({ appointmentId: f.id }); // Private fixture only; prepare the regular paid path.
  await changeAppointment(f.id, { action: "complete", finalPrice: 50, paymentMethod: "pix" }, "admin-owner");
  await assert.rejects(changeAppointment(f.id, { action: "return", reason: "Tentativa de devolver após pagamento" }, "admin-owner"), { status: 409 });
  assert.equal((await Appointment.findById(f.id)).status, "completed");
  assert.equal(await Transaction.countDocuments({ appointmentId: f.id }), 1);
});

test("Pagamento e devolução concorrentes produzem somente um encerramento financeiro ou operacional", async () => {
  const f = await fixture(9);
  await ready(f.id);
  const outcomes = await Promise.allSettled([
    changeAppointment(f.id, { action: "return", reason: "Cliente retirou sem pagamento" }, "second-admin"),
    changeAppointment(f.id, { action: "complete", finalPrice: 50, paymentMethod: "pix" }, "admin-owner"),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const failed = outcomes.find(outcome => outcome.status === "rejected");
  if (failed?.status === "rejected") assert.equal(failed.reason.status, 409);
  const stored = await Appointment.findById(f.id);
  const receiptCount = await Transaction.countDocuments({ appointmentId: f.id });
  assert.equal(receiptCount, stored.status === "completed" ? 1 : 0);
  assert.equal((await User.findById(f.user._id)).totalWashes, receiptCount);
  assert.equal((await User.findById(f.user._id)).loyaltyCount, receiptCount ? 0 : 9);
  assert.equal(await Coupon.countDocuments({ issueKey: `appointment:${f.id}` }), receiptCount);
  assert.equal(await Audit.countDocuments({ appointmentId: f.id, action: { $in: ["complete", "return"] } }), 1);
  assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 0);
});
