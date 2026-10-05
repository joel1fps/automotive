import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Appointment, Settings, Slot, Transaction, connectDB } from "../src/lib/db";
import { assertHomologationUri, migrateOperationalData } from "../src/lib/operational-migration";
import { defaultSettings } from "../src/lib/catalog";

let server: MongoMemoryReplSet;
before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = server.getUri("automotive_homologacao");
  await connectDB();
  await Settings.create(defaultSettings);
}, { timeout: 240000 });
after(async () => { await mongoose.disconnect(); await server?.stop(); });

test("Migração recusa qualquer base fora da homologação", () => {
  assert.throws(() => assertHomologationUri("mongodb://127.0.0.1:27017/producao"), /homologacao/);
});
test("Migração reconcilia vagas e enriquece recibos sem alterar histórico, dados ou bloqueios", async () => {
  const scheduledAt = new Date("2026-10-05T11:00:00Z");
  const key = scheduledAt.toISOString();
  await Slot.create({ key, used: 7, blocked: true, capacity: 5 });
  const [active, ended] = await Appointment.create([
    { vehicle: { model: "Teste", plate: "MIG1A23", type: "small" }, scheduledAt,
      serviceName: "Lavagem teste", status: "confirmed", quotedPrice: 30 },
    { vehicle: { model: "Teste encerrado", plate: "MIG2A23", type: "small" }, scheduledAt,
      serviceName: "Lavagem encerrada", status: "completed", quotedPrice: 30, finalPrice: 30 },
  ]);
  const receipt = await Transaction.create({ appointmentId: ended._id, source: "appointment",
    date: new Date(), amount: 30, paymentMethod: "pix", description: "Original" });
  const first = await migrateOperationalData();
  assert.equal(first.slotKeysAdded, 1);
  assert.equal(first.slotsReconciled, 1);
  assert.equal(first.receiptsEnriched, 1);
  const slot = await Slot.findOne({ key });
  assert.equal(slot.used, 1);
  assert.equal(slot.blocked, true);
  assert.equal(slot.capacity, 5);
  assert.equal((await Appointment.findById(active._id)).status, "confirmed");
  assert.equal((await Appointment.findById(ended._id)).status, "completed");
  const enriched = await Transaction.findById(receipt._id);
  assert.equal(enriched.vehiclePlate, "MIG2A23");
  assert.equal(enriched.description, "Original");
  assert.equal(enriched.amount, 30);
  const second = await migrateOperationalData();
  assert.deepEqual(second, { slotKeysAdded: 0, slotsReconciled: 0, releasesMarked: 0, receiptsEnriched: 0 });
  assert.equal(await Appointment.countDocuments(), 2);
});

test("Reserva legada sem vaga conhecida reverte a migração e exige revisão", async () => {
  const unknown = await Appointment.create({
    vehicle: { model: "Legado", plate: "MIG3A23", type: "small" },
    scheduledAt: new Date("2026-10-05T07:00:00Z"), serviceName: "Legado",
    status: "confirmed", quotedPrice: 30,
  });
  const before = (await Slot.find().lean()).map(slot => ({ key: slot.key, used: slot.used }));
  await assert.rejects(migrateOperationalData(), /vaga identificável/);
  assert.deepEqual((await Slot.find().lean()).map(slot => ({ key: slot.key, used: slot.used })), before);
  const unchanged = await Appointment.findById(unknown._id);
  assert.equal(unchanged.status, "confirmed");
  assert.equal(unchanged.slotKey, undefined);
});
