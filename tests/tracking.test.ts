import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Appointment, Audit, connectDB } from "../src/lib/db";
import {
  generateTracking, readAdminTracking, readPublicTracking, revokeTracking,
  trackingActionSchema, trackingTokenHash, updateTrackingEstimate,
} from "../src/lib/tracking";

let server: MongoMemoryReplSet;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = server.getUri("tracking_test");
  await connectDB();
  await Promise.all([Appointment, Audit].map(model => model.init()));
}, { timeout: 240000 });
afterEach(async () => { await Promise.all([Appointment, Audit].map(model => model.deleteMany({}))); });
after(async () => { await mongoose.disconnect(); await server?.stop(); });

const vehicle = { model: "Onix", plate: "ABC1D23", type: "small" };
const tokenFrom = (url: string | null) => {
  assert.ok(url);
  return url.slice("/acompanhar/".length);
};
async function fixture(overrides: Record<string, unknown> = {}) {
  return Appointment.create({
    vehicle, serviceName: "Lavagem simples", scheduledAt: new Date(Date.now() + 3600000),
    status: "pending", userId: new mongoose.Types.ObjectId(), guestName: "Nome privado",
    guestPhone: "5585999991234", notes: "Observação interna", quotedPrice: 35, finalPrice: 30,
    couponId: new mongoose.Types.ObjectId(), paymentMethod: "pix", createdBy: "admin-private",
    ...overrides,
  });
}

test("Link seguro e exclusivo divulga somente o veículo e o andamento do atendimento", async () => {
  const first = await fixture();
  const second = await fixture({ vehicle: { ...vehicle, plate: "DEF2G34", model: "Outro veículo" } });
  const link = await generateTracking(String(first._id), "generate", "admin");
  const other = await generateTracking(String(second._id), "generate", "admin");
  const token = tokenFrom(link.url);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.notEqual(link.url, other.url);
  const dto = await readPublicTracking(token);
  assert.deepEqual(Object.keys(dto).sort(), [
    "vehicle", "serviceName", "scheduledAt", "walkIn", "status", "createdAt", "confirmedAt",
    "arrivedAt", "startedAt", "readyAt", "deliveredAt", "returnedAt", "estimatedCompletionAt", "updatedAt",
  ].sort());
  assert.deepEqual(dto.vehicle, { model: "Onix", plate: "ABC1D23" });
  assert.equal(dto.serviceName, "Lavagem simples");
  const serialized = JSON.stringify(dto);
  for (const secret of ["Nome privado", "5585999991234", "Observação interna", "admin-private", String(first._id), String(first.userId), token, "DEF2G34", "paymentMethod", "couponId", "finalPrice"])
    assert.equal(serialized.includes(secret), false, `DTO publicou dado restrito: ${secret}`);
});

test("Token e hash nunca aparecem nas consultas usuais de agendamentos", async () => {
  const appointment = await fixture();
  const info = await generateTracking(String(appointment._id), "generate", "admin");
  const token = tokenFrom(info.url);
  const normal = await Appointment.findById(appointment._id).lean();
  assert.equal(normal.trackingToken, undefined);
  assert.equal(normal.trackingTokenHash, undefined);
  assert.equal(JSON.stringify(normal).includes(token), false);
  const stored = await Appointment.findById(appointment._id).select("+trackingToken +trackingTokenHash");
  assert.equal(stored.trackingToken, token);
  assert.equal(stored.trackingTokenHash, trackingTokenHash(token));
  assert.equal((await readAdminTracking(String(appointment._id))).url, info.url);
});

test("Gerar de novo preserva o link ativo e não duplica a auditoria", async () => {
  const appointment = await fixture();
  const first = await generateTracking(String(appointment._id), "generate", "admin");
  const repeated = await generateTracking(String(appointment._id), "generate", "admin");
  assert.deepEqual(first, repeated);
  assert.equal(await Audit.countDocuments({ action: "tracking_generated" }), 1);
});

test("Solicitações concorrentes para gerar produzem um único link ativo", async () => {
  const appointment = await fixture();
  const results = await Promise.all(Array.from({ length: 5 }, () => generateTracking(String(appointment._id), "generate", "admin")));
  assert.equal(new Set(results.map(result => result.url)).size, 1);
  assert.equal(await Audit.countDocuments({ action: "tracking_generated" }), 1);
  assert.equal((await readPublicTracking(tokenFrom(results[0].url))).vehicle.plate, vehicle.plate);
});

test("Renovar e revogar invalidam imediatamente o token anterior", async () => {
  const appointment = await fixture();
  const first = await generateTracking(String(appointment._id), "generate", "admin");
  const rotated = await generateTracking(String(appointment._id), "regenerate", "admin");
  assert.notEqual(first.url, rotated.url);
  await assert.rejects(readPublicTracking(tokenFrom(first.url)), { status: 404, message: "Link de acompanhamento indisponível." });
  assert.equal((await readPublicTracking(tokenFrom(rotated.url))).status, "pending");
  const revoked = await revokeTracking(String(appointment._id), "admin");
  assert.equal(revoked.active, false);
  assert.equal(revoked.url, null);
  assert.ok(revoked.revokedAt);
  await assert.rejects(readPublicTracking(tokenFrom(rotated.url)), { status: 404, message: "Link de acompanhamento indisponível." });
  assert.deepEqual(await revokeTracking(String(appointment._id), "admin"), revoked);
  const generatedAgain = await generateTracking(String(appointment._id), "generate", "admin");
  assert.equal(generatedAgain.active, true);
  assert.equal(generatedAgain.revokedAt, null);
  assert.notEqual(generatedAgain.url, rotated.url);
});

test("Tokens malformados e desconhecidos recebem o mesmo erro genérico", async () => {
  for (const token of ["", "123", "../admin", "a".repeat(43), "a".repeat(44)])
    await assert.rejects(readPublicTracking(token), { status: 404, message: "Link de acompanhamento indisponível." });
});

test("Índice único impede tokens duplicados e aceita agendamentos sem token", async () => {
  const appointment = await fixture();
  await fixture();
  const generated = await generateTracking(String(appointment._id), "generate", "admin");
  await assert.rejects(fixture({ trackingTokenHash: trackingTokenHash(tokenFrom(generated.url)) }), { code: 11000 });
  assert.equal(await Appointment.countDocuments(), 2);
});

test("Previsão valida datas e campos, publica a atualização e registra auditoria sem tokens", async () => {
  const appointment = await fixture({ status: "in_progress" });
  const id = String(appointment._id);
  const link = await generateTracking(id, "generate", "admin");
  for (const input of [
    { estimatedCompletionAt: "ontem" }, { estimatedCompletionAt: new Date(Date.now() - 1000).toISOString() },
    { estimatedCompletionAt: new Date(Date.now() + 60000).toISOString(), status: "delivered" },
    { estimatedCompletionAt: null, guestName: "Outro cliente" },
  ]) await assert.rejects(updateTrackingEstimate(id, input, "admin"));
  const estimate = new Date(Date.now() + 7200000).toISOString();
  const updated = await updateTrackingEstimate(id, { estimatedCompletionAt: estimate }, "admin");
  assert.equal(updated.estimatedCompletionAt, estimate);
  assert.equal((await readPublicTracking(tokenFrom(link.url))).estimatedCompletionAt, estimate);
  await updateTrackingEstimate(id, { estimatedCompletionAt: null }, "admin");
  assert.equal((await readPublicTracking(tokenFrom(link.url))).estimatedCompletionAt, null);
  const audit = JSON.stringify(await Audit.find().lean());
  assert.equal(audit.includes(tokenFrom(link.url)), false);
  assert.equal(audit.includes(trackingTokenHash(tokenFrom(link.url))), false);
  assert.equal(audit.includes("/acompanhar/"), false);
  assert.equal(await Audit.countDocuments({ action: "tracking_estimate_updated" }), 2);
  assert.throws(() => trackingActionSchema.parse({ action: "generate", token: "chosen-by-client" }));
});

test("Página lê o fluxo operacional vigente e segue acessível após entrega", async () => {
  const appointment = await fixture();
  const id = String(appointment._id);
  const link = await generateTracking(id, "generate", "admin");
  for (const status of ["confirmed", "arrived", "in_progress", "ready", "completed", "delivered", "cancelled", "rejected", "returned"]) {
    await Appointment.updateOne({ _id: id }, { $set: { status, ...(status === "delivered" ? { deliveredAt: new Date() } : {}) } });
    assert.equal((await readPublicTracking(tokenFrom(link.url))).status, status);
    if (["ready", "completed", "delivered", "cancelled", "rejected", "returned"].includes(status)) {
      await assert.rejects(updateTrackingEstimate(id, { estimatedCompletionAt: new Date(Date.now() + 60000).toISOString() }, "admin"), { status: 409 });
      await updateTrackingEstimate(id, { estimatedCompletionAt: null }, "admin");
    }
  }
});
test("Devolução informa data e status públicos sem divulgar o motivo interno", async () => {
  const returnedAt = new Date(Date.now() - 60000);
  const appointment = await fixture({ status: "returned", returnedAt, returnReason: "Motivo administrativo privado da devolução" });
  const id = String(appointment._id);
  const link = await generateTracking(id, "generate", "admin");
  const dto = await readPublicTracking(tokenFrom(link.url));
  assert.equal(dto.status, "returned");
  assert.equal(dto.returnedAt, returnedAt.toISOString());
  assert.equal(Object.hasOwn(dto, "returnReason"), false);
  assert.equal(JSON.stringify(dto).includes("Motivo administrativo privado"), false);
  await assert.rejects(updateTrackingEstimate(id, { estimatedCompletionAt: new Date(Date.now() + 7200000).toISOString() }, "admin"), { status: 409 });
});

test("Falha na auditoria reverte o token e a previsão juntos", async () => {
  const appointment = await fixture();
  const id = String(appointment._id);
  const create = Audit.create;
  Audit.create = async () => { throw new Error("audit-test-failure"); };
  try {
    await assert.rejects(generateTracking(id, "generate", "admin"), /audit-test-failure/);
    assert.equal((await readAdminTracking(id)).active, false);
    await assert.rejects(updateTrackingEstimate(id, { estimatedCompletionAt: new Date(Date.now() + 7200000).toISOString() }, "admin"), /audit-test-failure/);
    assert.equal((await readAdminTracking(id)).estimatedCompletionAt, null);
  } finally {
    Audit.create = create;
  }
});

test("Novo aprovado não pode remover previsão nem informar entrega antes do atendimento", async () => {
  const appointment = await fixture({ flexibleSchedule: true, status: "confirmed", estimatedCompletionAt: new Date(Date.now() + 7200000) });
  const id = String(appointment._id);
  await assert.rejects(updateTrackingEstimate(id, { estimatedCompletionAt: null }, "admin"), { status: 409 });
  await assert.rejects(updateTrackingEstimate(id, { estimatedCompletionAt: new Date(Date.now() + 60000).toISOString() }, "admin"), /igual ou posterior/);
  const estimate = new Date(Date.now() + 10800000).toISOString();
  await updateTrackingEstimate(id, { estimatedCompletionAt: estimate }, "admin");
  assert.equal((await readAdminTracking(id)).estimatedCompletionAt, estimate);
  assert.equal(await Audit.countDocuments({ appointmentId: id, action: "tracking_estimate_updated" }), 1);
});
