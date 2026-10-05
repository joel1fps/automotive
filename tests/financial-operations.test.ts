import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Appointment, Audit, Coupon, Service, Slot, Submission, Transaction, User, connectDB } from "../src/lib/db";
import { createBooking, changeAppointment, seedCatalog } from "../src/lib/business";
import { createManualTransaction, issueManualCoupon, correctTransaction, transactionNets } from "../src/lib/financial-operations";
import { financeSummary, servicesReport } from "../src/lib/finance";
import { periodBounds, localDate } from "../src/lib/domain";

let server: MongoMemoryReplSet;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = server.getUri("financial_operations_test");
  await connectDB(); await seedCatalog();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}, { timeout: 240000 });
afterEach(async () => { await Promise.all([Appointment, Audit, Coupon, Slot, Submission, Transaction, User].map(model => model.deleteMany({}))); });
after(async () => { await mongoose.disconnect(); await server?.stop(); });
const actor = { clerkId: "operations-admin" };
const vehicle = { plate: "OPS1A23", model: "Onix fictício", type: "small" as const };
const reason = "Correção solicitada pelo responsável";
async function customer(points = 0, washes = 0) {
  return User.create({ clerkId: randomUUID(), name: "Cliente fictício", phone: "5585999991234", loyaltyCount: points, totalWashes: washes });
}
async function paid(user: any, amount = 100) {
  const service = await Service.findOne({ slug: "simples" });
  const appointment = await createBooking({ userId: String(user._id), vehicle, serviceId: String(service._id), walkIn: true, notes: "", requestId: randomUUID() }, actor, true);
  for (const action of ["start", "ready"] as const) await changeAppointment(String(appointment._id), { action }, actor.clerkId);
  await changeAppointment(String(appointment._id), { action: "complete", finalPrice: amount, paymentMethod: "pix" }, actor.clerkId);
  return { appointment, receipt: await Transaction.findOne({ appointmentId: appointment._id }) };
}
test("Envios concorrentes e resposta perdida repetem um agendamento sem repetir veículo, audit ou limite", async () => {
  const user = await customer(), service = await Service.findOne({ slug: "simples" });
  const payload = { userId: String(user._id), vehicle, serviceId: String(service._id), scheduledAt: new Date(Date.now() + 86400000).toISOString(), estimatedCompletionAt: new Date(Date.now() + 90000000).toISOString(), notes: "", requestId: randomUUID() };
  const [first, second] = await Promise.all([createBooking(payload, actor, true), createBooking(payload, actor, true)]);
  assert.equal(String(first._id), String(second._id));
  assert.equal(String((await createBooking(payload, actor, true))._id), String(first._id));
  assert.equal(await Appointment.countDocuments(), 1); assert.equal(await Audit.countDocuments({ action: "booking_created" }), 1);
  await assert.rejects(createBooking({ ...payload, notes: "Outro envio" }, actor, true), { status: 409 });
});
test("Cupom manual tem envio único, auditoria atômica e permite nova emissão intencional", async () => {
  const user = await customer(); const payload = { userId: String(user._id), vehicle, expiresAt: new Date(Date.now() + 86400000).toISOString(), reason, requestId: randomUUID() };
  const [a, b] = await Promise.all([issueManualCoupon(payload, actor.clerkId), issueManualCoupon(payload, actor.clerkId)]);
  assert.equal(String(a._id), String(b._id)); assert.equal(await Coupon.countDocuments(), 1);
  assert.equal(await Audit.countDocuments({ action: "manual_coupon" }), 1);
  await issueManualCoupon({ ...payload, requestId: randomUUID() }, actor.clerkId); assert.equal(await Coupon.countDocuments(), 2);
  const original = Audit.create; Audit.create = (async () => { throw new Error("audit failure"); }) as typeof Audit.create;
  try { await assert.rejects(issueManualCoupon({ ...payload, requestId: randomUUID() }, actor.clerkId), /audit failure/); }
  finally { Audit.create = original; }
  assert.equal(await Coupon.countDocuments(), 2); assert.equal(await Submission.countDocuments(), 2);
});
test("Lançamento manual repetido mantém um recibo e um log, chave não pode reutilizar outro valor", async () => {
  const payload = { description: "Venda fictícia", category: "extra", amount: 50, paymentMethod: "pix", date: new Date().toISOString(), notes: "", requestId: randomUUID() };
  const [a, b] = await Promise.all([createManualTransaction(payload, actor.clerkId), createManualTransaction(payload, actor.clerkId)]);
  assert.equal(String(a._id), String(b._id)); assert.equal(await Transaction.countDocuments(), 1);
  assert.equal(await Audit.countDocuments({ action: "manual_transaction" }), 1);
  await assert.rejects(createManualTransaction({ ...payload, amount: 55 }, actor.clerkId), { status: 409 });
});
test("Correção preserva recibo original, ajusta saldo e preço e não altera a fidelidade se o valor continua positivo", async () => {
  const user = await customer(), f = await paid(user);
  const input = { action: "correct", correctedAmount: 38, reason, requestId: randomUUID() };
  const [a, b] = await Promise.all([correctTransaction(String(f.receipt._id), input, actor.clerkId), correctTransaction(String(f.receipt._id), input, actor.clerkId)]);
  assert.equal(String(a._id), String(b._id)); assert.equal(a.netAmount, 38);
  assert.equal((await Transaction.findById(f.receipt._id)).amount, 100);
  assert.equal(await Transaction.countDocuments({ correctionOf: f.receipt._id }), 1);
  assert.equal((await Appointment.findById(f.appointment._id)).finalPrice, 38);
  assert.equal((await User.findById(user._id)).loyaltyCount, 1);
  const audit = await Audit.findOne({ action: "payment_corrected" }); assert.equal(audit.before, 100); assert.equal(audit.after, 38);
  const list = await transactionNets([f.receipt.toObject(), a]); assert.equal(list[0].netAmount, 38);
  assert.equal(list[0].canCorrect, true);assert.equal(list[1].canCorrect, false);
  const filter = periodBounds("day", localDate(new Date())); assert.equal((await financeSummary(filter)).total, 38);
  assert.equal((await servicesReport({ ...filter, criterion: "ready" })).items[0].received, 38);
});
test("Estorno integral remove somente uma contribuição e nova correção positiva regulariza o crédito", async () => {
  const user = await customer(3, 3), f = await paid(user);
  const input = { action: "refund", reason, requestId: randomUUID() };
  await correctTransaction(String(f.receipt._id), input, actor.clerkId);
  await correctTransaction(String(f.receipt._id), input, actor.clerkId);
  let updated = await User.findById(user._id); assert.equal(updated.loyaltyCount, 3); assert.equal(updated.totalWashes, 3);
  await assert.rejects(correctTransaction(String(f.receipt._id), { ...input, requestId: randomUUID() }, actor.clerkId), { status: 409 });
  await correctTransaction(String(f.receipt._id), { action: "correct", correctedAmount: 25, reason, requestId: randomUUID() }, actor.clerkId);
  updated = await User.findById(user._id); assert.equal(updated.loyaltyCount, 4); assert.equal(updated.totalWashes, 4);
});
test("Estorno da recompensa revoga somente cupom livre e permite reconstituir a recompensa sem conflito de chave", async () => {
  const user = await customer(9, 9), f = await paid(user);
  await correctTransaction(String(f.receipt._id), { action: "refund", reason, requestId: randomUUID() }, actor.clerkId);
  let updated = await User.findById(user._id); assert.equal(updated.loyaltyCount, 9); assert.equal(updated.totalWashes, 9);
  assert.equal(await Coupon.countDocuments({ status: "revoked" }), 1);
  await correctTransaction(String(f.receipt._id), { action: "correct", correctedAmount: 50, reason, requestId: randomUUID() }, actor.clerkId);
  updated = await User.findById(user._id); assert.equal(updated.loyaltyCount, 0); assert.equal(updated.totalWashes, 10);
  assert.equal(await Coupon.countDocuments({ status: "available" }), 1); assert.equal(await Coupon.countDocuments({ status: "revoked" }), 1);
});
test("Cupom já usado permanece válido historicamente e o próximo crédito regulariza o estorno", async () => {
  const user = await customer(9, 9), f = await paid(user);
  await Coupon.updateOne({ userId: user._id }, { $set: { status: "used", usedAt: new Date() } });
  await correctTransaction(String(f.receipt._id), { action: "refund", reason, requestId: randomUUID() }, actor.clerkId);
  let updated = await User.findById(user._id); assert.equal(updated.loyaltyDebt, 1); assert.equal(updated.totalWashes, 9);
  assert.equal(await Coupon.countDocuments({ status: "used" }), 1);
  await paid(updated);
  updated = await User.findById(user._id); assert.equal(updated.loyaltyDebt, 0); assert.equal(updated.loyaltyCount, 0); assert.equal(updated.totalWashes, 10);
});
test("Recompensa vencida não retorna nove pontos, mesmo antes de a consulta marcar o cupom como expirado", async () => {
  for (const status of ["available", "expired"]) {
    const user = await customer(9, 9), f = await paid(user);
    await Coupon.updateOne({ userId: user._id }, { $set: { status, issuedAt: new Date(Date.now() - 31 * 86400000), expiresAt: new Date(Date.now() - 86400000) } });
    await correctTransaction(String(f.receipt._id), { action: "refund", reason, requestId: randomUUID() }, actor.clerkId);
    let updated = await User.findById(user._id);
    assert.equal(updated.loyaltyDebt, 1, status);assert.equal(updated.loyaltyCount, 0, status);assert.equal(updated.totalWashes, 9);
    const expired = await Coupon.findOne({ userId: user._id });
    assert.equal(expired.status, status);assert.equal(expired.revokedAt, undefined);
    await paid(updated);
    updated = await User.findById(user._id);
    assert.equal(updated.loyaltyDebt, 0);assert.equal(updated.loyaltyCount, 0);assert.equal(updated.totalWashes, 10);
    assert.equal(await Coupon.countDocuments({ userId: user._id }), 1, "O cupom vencido não ganha uma nova validade");
  }
});
test("Estorno preserva recompensa reservada por outro atendimento e o próximo crédito compensa sem emitir novo cupom", async () => {
  const user = await customer(9, 9), f = await paid(user), service = await Service.findOne({ slug: "simples" });
  const coupon = await Coupon.findOne({ userId: user._id });
  const scheduledAt = new Date(Date.now() + 86400000);
  const reservation = await createBooking({ userId: String(user._id), vehicle, serviceId: String(service._id), couponId: String(coupon._id),
    scheduledAt: scheduledAt.toISOString(), estimatedCompletionAt: new Date(+scheduledAt + 3600000).toISOString(), notes: "", requestId: randomUUID() }, actor, true);
  await correctTransaction(String(f.receipt._id), { action: "refund", reason, requestId: randomUUID() }, actor.clerkId);
  let updated = await User.findById(user._id);
  assert.equal(updated.loyaltyDebt, 1);assert.equal(updated.loyaltyCount, 0);assert.equal(updated.totalWashes, 9);
  const reserved = await Coupon.findById(coupon._id);
  assert.equal(reserved.status, "available");assert.equal(String(reserved.reservedAppointmentId), String(reservation._id));
  assert.equal(reserved.revokedAt, undefined);assert.equal((await Appointment.findById(reservation._id)).status, "confirmed");
  await paid(updated);
  updated = await User.findById(user._id);
  assert.equal(updated.loyaltyDebt, 0);assert.equal(updated.loyaltyCount, 0);assert.equal(updated.totalWashes, 10);
  assert.equal(await Coupon.countDocuments({ userId: user._id }), 1);
  assert.equal(String((await Coupon.findById(coupon._id)).reservedAppointmentId), String(reservation._id));
});
test("Recibo de cortesia e linha de ajuste não oferecem correção financeira", async () => {
  const user = await customer(), service = await Service.findOne({ slug: "simples" });
  const coupon = await issueManualCoupon({ userId: String(user._id), vehicle, expiresAt: new Date(Date.now() + 86400000).toISOString(), reason, requestId: randomUUID() }, actor.clerkId);
  const appointment = await createBooking({ userId: String(user._id), vehicle, serviceId: String(service._id), couponId: String(coupon._id), walkIn: true, notes: "", requestId: randomUUID() }, actor, true);
  for (const action of ["start", "ready"] as const) await changeAppointment(String(appointment._id), { action }, actor.clerkId);
  await changeAppointment(String(appointment._id), { action: "complete", finalPrice: 100, paymentMethod: "pix" }, actor.clerkId);
  const receipt = await Transaction.findOne({ appointmentId: appointment._id });
  const list = await transactionNets([receipt.toObject()]);assert.equal(list[0].canCorrect, false);
  await assert.rejects(correctTransaction(String(receipt._id), { action: "correct", correctedAmount: 50, reason, requestId: randomUUID() }, actor.clerkId), { status: 409 });
  assert.equal(await Transaction.countDocuments({ correctionOf: receipt._id }), 0);
  assert.equal((await User.findById(user._id)).loyaltyCount, 0);
});
test("Falha na auditoria do estorno reverte preço, fidelidade, compensação e identidade do envio", async () => {
  const user = await customer(), f = await paid(user);
  const original = Audit.create; Audit.create = (async () => { throw new Error("audit refund failure"); }) as typeof Audit.create;
  const requestId = randomUUID();
  try { await assert.rejects(correctTransaction(String(f.receipt._id), { action: "refund", reason, requestId }, actor.clerkId), /audit refund failure/); }
  finally { Audit.create = original; }
  assert.equal((await User.findById(user._id)).loyaltyCount, 1);
  assert.equal((await Appointment.findById(f.appointment._id)).finalPrice, 100);
  assert.equal(await Transaction.countDocuments({ source: "adjustment" }), 0);
  assert.equal((await Transaction.findById(f.receipt._id)).correctionVersion, 0);
  await correctTransaction(String(f.receipt._id), { action: "refund", reason, requestId }, actor.clerkId);
  assert.equal(await Transaction.countDocuments({ source: "adjustment" }), 1);
});
test("Estorno e correção concorrentes com chaves diferentes compõem saldo e auditoria sem duplicar crédito", async () => {
  const user = await customer(3, 3), f = await paid(user);
  const inputs = [{ action: "refund", reason, requestId: randomUUID() },
    { action: "correct", correctedAmount: 38, reason, requestId: randomUUID() }];
  const outcomes = await Promise.allSettled(inputs.map(input => correctTransaction(String(f.receipt._id), input, actor.clerkId)));
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 2, "As duas ações são válidas quando serializadas, em qualquer ordem");
  for (const outcome of outcomes) if (outcome.status === "rejected") assert.fail(String(outcome.reason));
  const adjustments = await Transaction.find({ correctionOf: f.receipt._id }).lean();
  assert.equal(adjustments.length, 2);
  const net = 100 + adjustments.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100;
  assert.ok([0, 38].includes(net), `Saldo inesperado: ${net}`);
  assert.equal((await Transaction.findById(f.receipt._id)).amount, 100);
  assert.equal((await Transaction.findById(f.receipt._id)).correctionVersion, 2);
  assert.equal((await Appointment.findById(f.appointment._id)).finalPrice, net);
  const logs = await Audit.find({ transactionId: f.receipt._id, action: { $in: ["payment_refunded", "payment_corrected"] } }).lean();
  assert.equal(logs.length, 2);
  const first = logs.find(log => log.before === 100);assert.ok(first);
  const second = logs.find(log => String(log._id) !== String(first._id));assert.ok(second);
  assert.equal(second.before, first.after, "O segundo ajuste começa no saldo deixado pelo primeiro");
  assert.equal(second.after, net);
  const updated = await User.findById(user._id);
  assert.equal(updated.loyaltyCount, net > 0 ? 4 : 3);
  assert.equal(updated.totalWashes, net > 0 ? 4 : 3);
  assert.equal(updated.loyaltyDebt, 0);
  assert.equal(await Coupon.countDocuments({ userId: user._id }), 0);
  const replayed = await Promise.all(inputs.map(input => correctTransaction(String(f.receipt._id), input, actor.clerkId)));
  for (let index = 0; index < outcomes.length; index++) {
    const outcome = outcomes[index];
    if (outcome.status === "fulfilled") assert.equal(String(replayed[index]._id), String(outcome.value._id));
  }
  assert.equal(await Transaction.countDocuments({ correctionOf: f.receipt._id }), 2);
  assert.equal(await Audit.countDocuments({ transactionId: f.receipt._id, action: { $in: ["payment_refunded", "payment_corrected"] } }), 2);
  assert.equal((await transactionNets([f.receipt.toObject()]))[0].netAmount, net);
});
