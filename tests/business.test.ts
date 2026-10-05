import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { addDays } from "date-fns";
import {
  createBooking,
  changeAppointment,
  seedCatalog,
  adjustPoints,
  availableSlots,
  getSettings,
  updateSettings,
} from "../src/lib/business";
import {
  Appointment,
  Audit,
  Coupon,
  Service,
  Slot,
  Transaction,
  User,
  Settings,
  connectDB,
} from "../src/lib/db";
import { expiryForReward, localDate, localSlots, periodBounds, AppError } from "../src/lib/domain";
import { defaultSettings, initialServices } from "../src/lib/catalog";
import { settingsSchema, manualBookingSchema } from "../src/lib/validation";
import { financeSummary, financeWorkbook } from "../src/lib/finance";
import { controlSummary, operationalQueue } from "../src/lib/control";
import ExcelJS from "exceljs";
import { spawnSync } from "node:child_process";
// Administrative fixtures include the delivery estimate required by approval.
function manualEstimate<T extends {scheduledAt?:string;walkIn?:boolean;estimatedCompletionAt?:string}>(input:T) {
  return input.walkIn || input.estimatedCompletionAt ? input : {...input, estimatedCompletionAt:new Date(+new Date(input.scheduledAt!)+3600000).toISOString()};
}
let server: MongoMemoryReplSet;
before(
  async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "8.0.13" },
    });
    process.env.MONGODB_URI = server.getUri();
    await connectDB();
    await seedCatalog();
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  },
  { timeout: 240000 },
);
after(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
afterEach(async () => {
  // These collections exist only in this process's private in-memory replica set.
  await Promise.all([Appointment, Audit, Coupon, Slot, Transaction, User].map(model => model.deleteMany({})));
});
const vehicle = { model: "Onix", plate: "ABC1D23", type: "small" as const };

test("Limite de agendamentos por cliente é atômico e não limita o administrador", async () => {
  const previous = process.env.MAX_CLIENT_ACTIVE_BOOKINGS;
  process.env.MAX_CLIENT_ACTIVE_BOOKINGS = "1";
  try {
    const customer = await User.create({ clerkId: "policy-client", name: "Cliente Segurança", phone: "5585999123456" });
    const settings = await getSettings();
    let day = addDays(new Date(), 1);
    while (!localSlots(localDate(day), settings).length) day = addDays(day, 1);
    const times = localSlots(localDate(day), settings);
    const service = await Service.findOne({ slug: "simples" });
    const input = { serviceId: String(service._id), vehicle, consent: true as const, notes: "" };
    const actor = { clerkId: "policy-client", userId: String(customer._id) };
    const outcomes = await Promise.allSettled(times.slice(0, 2).map(time => createBooking({ ...input, scheduledAt: time.toISOString() }, actor)));
    assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof AppError && rejected.reason.status === 409);
    assert.equal(await Appointment.countDocuments({ userId: customer._id }), 1);
    const manual = await createBooking(manualEstimate({ ...input, scheduledAt: times[2].toISOString(), userId: String(customer._id) }), { clerkId: "policy-admin" }, true);
    assert.equal(manual.status, "confirmed");
    assert.equal(await Appointment.countDocuments({ userId: customer._id }), 2);
  } finally { if (previous === undefined) delete process.env.MAX_CLIENT_ACTIVE_BOOKINGS; else process.env.MAX_CLIENT_ACTIVE_BOOKINGS = previous; }
});

test("Antecedência máxima bloqueia reserva distante sem ocupar vaga e mantém cadastro admin", async () => {
  const previous = process.env.MAX_CLIENT_BOOKING_ADVANCE_DAYS;
  process.env.MAX_CLIENT_BOOKING_ADVANCE_DAYS = "30";
  try {
    const customer = await User.create({ clerkId: "policy-future", name: "Cliente Futuro", phone: "5585999123456" });
    const settings = await getSettings();
    let day = addDays(new Date(), 35);
    while (!localSlots(localDate(day), settings).length) day = addDays(day, 1);
    const time = localSlots(localDate(day), settings)[0];
    const service = await Service.findOne({ slug: "simples" });
    const input = { serviceId: String(service._id), vehicle, scheduledAt: time.toISOString(), consent: true as const, notes: "" };
    await assert.rejects(createBooking(input, { clerkId: "policy-future", userId: String(customer._id) }), error => error instanceof AppError && error.status === 400 && /30 dias/.test(error.message));
    assert.equal(await Slot.countDocuments({ key: time.toISOString() }), 0);
    const manual = await createBooking(manualEstimate({ ...input, userId: String(customer._id) }), { clerkId: "policy-admin" }, true);
    assert.equal(manual.status, "confirmed");
  } finally { if (previous === undefined) delete process.env.MAX_CLIENT_BOOKING_ADVANCE_DAYS; else process.env.MAX_CLIENT_BOOKING_ADVANCE_DAYS = previous; }
});
async function fixture(points = 0) {
  const user = await User.create({
    clerkId: `test-${new mongoose.Types.ObjectId()}`,
    name: "Cliente Teste",
    phone: "5585999991234",
    loyaltyCount: points,
  });
  const service = await Service.findOne({ slug: "simples" });
  let day = addDays(new Date(), 4);
  while (!localSlots(localDate(day), defaultSettings).length)
    day = addDays(day, 1);
  return { user, service, slots: localSlots(localDate(day), defaultSettings) };
}
async function prepareReady(id: string) {
  if ((await Appointment.findById(id)).status === "pending") await approve(id);
  for (const action of ["arrive", "start", "ready"] as const) await changeAppointment(id, {action}, "admin");
}
async function approve(id: string, actor = "admin") {
  const appointment = await Appointment.findById(id);
  return changeAppointment(id, { action: "confirm", estimatedCompletionAt: new Date(+appointment.scheduledAt + 3600000).toISOString() }, actor);
}
// Persist the old reservation shape explicitly to exercise backwards compatibility.
async function legacyReservation(appointment: Record<string, any>): Promise<Record<string, any>> {
  const key = appointment.scheduledAt.toISOString();
  await Appointment.updateOne({ _id: appointment._id }, { $set: { flexibleSchedule: false, slotKey: key } });
  await Slot.updateOne({ key }, { $inc: { used: 1 }, $setOnInsert: { blocked: false } }, { upsert: true });
  return { ...appointment, flexibleSchedule: false, slotKey: key };
}
test("Configurações ausentes são inicializadas uma única vez sob concorrência", async () => {
  await Settings.deleteOne({ key: "main" });
  const settings = await Promise.all(Array.from({ length: 12 }, () => getSettings()));
  assert.equal(await Settings.countDocuments({ key: "main" }), 1);
  assert.equal(new Set(settings.map(value => String(value._id))).size, 1);
  assert.ok(settings.every(value => value.capacityPerSlot === defaultSettings.capacityPerSlot));
});

test("Inicialização completa catálogo parcial sem reativar ou sobrescrever serviços", async () => {
  const preserved = await Service.findOne({ slug: initialServices[0].slug }).lean();
  const missing = initialServices[1];
  const custom = await Service.create({ slug: "servico-auditoria", name: "Serviço independente", active: false });
  try {
    await Service.updateOne({ _id: preserved._id }, { $set: { name: "Preço personalizado", active: false, "prices.small": 73.25 } });
    await Service.deleteOne({ slug: missing.slug });
    await Promise.all([seedCatalog(), seedCatalog()]);
    const current = await Service.findById(preserved._id).lean();
    assert.equal(current.name, "Preço personalizado");
    assert.equal(current.active, false);
    assert.equal(current.prices.small, 73.25);
    assert.equal(await Service.countDocuments({ slug: missing.slug }), 1);
    assert.equal((await Service.findOne({ slug: missing.slug })).name, missing.name);
    assert.equal((await Service.findById(custom._id)).active, false);
    await seedCatalog();
    assert.equal((await Service.findById(preserved._id)).active, false);
  } finally {
    await Service.updateOne({ _id: preserved._id }, { $set: { name: preserved.name, active: preserved.active, prices: preserved.prices } });
    await Service.deleteOne({ _id: custom._id });
    await seedCatalog();
  }
});

test("Configurações preservam reservas futuras e permitem mudanças seguras", async () => {
  const input = settingsSchema.parse(defaultSettings);
  const f = await fixture();
  try {
    assert.equal((await updateSettings({ ...input, slotDuration: 30 })).slotDuration, 30);
    await updateSettings(input);
    const booking = await createBooking({
      serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(),
      consent: true, notes: "",
    }, { clerkId: f.user.clerkId, userId: String(f.user._id) });
    await legacyReservation(booking);
    for (const status of ["pending", "confirmed", "arrived", "in_progress", "ready"]) {
      await Appointment.updateOne({ _id: booking._id }, { $set: { status } });
      for (const change of [
        { openTime: "09:00" }, { closeTime: "16:00" },
        { slotDuration: 30 }, { openingDays: [1] },
      ]) {
        await assert.rejects(updateSettings({ ...input, ...change }), /agendamentos futuros ativos/);
      }
    }
    const safe = await updateSettings({ ...input, capacityPerSlot: 2, provisionalHours: true, openingDays: [...input.openingDays].reverse() });
    assert.equal(safe.capacityPerSlot, 2);
    assert.equal(safe.provisionalHours, true);
    assert.equal(safe.slotDuration, 60);
    assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() })).used, 1);
    assert.equal((await Appointment.findById(booking._id)).slotKey, f.slots[0].toISOString());
    for (const status of ["cancelled", "rejected", "completed", "delivered"]) {
      await Appointment.updateOne({ _id: booking._id }, { $set: { status } });
      assert.equal((await updateSettings({ ...input, slotDuration: 30 })).slotDuration, 30);
      await updateSettings(input);
    }
    await Appointment.updateOne({ _id: booking._id }, { $set: { status: "confirmed", scheduledAt: new Date(Date.now() - 60000) } });
    assert.equal((await updateSettings({ ...input, openTime: "09:00" })).openTime, "09:00");
  } finally {
    await Appointment.deleteMany({ userId: f.user._id });
    await Slot.deleteOne({ key: f.slots[0].toISOString() });
    await User.deleteOne({ _id: f.user._id });
    await updateSettings(input);
  }
});
test("Alteração da grade não restringe solicitações livres concorrentes", async () => {
  const input = settingsSchema.parse(defaultSettings);
  const f = await fixture();
  try {
    const [changed, booked] = await Promise.allSettled([
      updateSettings({ ...input, openTime: "08:15" }),
      createBooking({
        serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(),
        consent: true, notes: "",
      }, { clerkId: f.user.clerkId, userId: String(f.user._id) }),
    ]);
    assert.equal([changed, booked].filter(result => result.status === "fulfilled").length, 2);
    const settings = await getSettings();
    const appointment = await Appointment.findOne({ userId: f.user._id });
    assert.equal(settings.openTime, "08:15");
    assert.equal(appointment.flexibleSchedule, true);
    assert.equal(appointment.slotKey, undefined);
    assert.equal(await Slot.countDocuments(), 0);
  } finally {
    await Appointment.deleteMany({ userId: f.user._id });
    await Slot.deleteOne({ key: f.slots[0].toISOString() });
    await User.deleteOne({ _id: f.user._id });
    await updateSettings(input);
  }
});
test("Concorrência: reagendamentos legados disputam a última vaga sem duplicar reserva", async () => {
  const f = await fixture();
  const input = {
    serviceId: String(f.service._id),
    vehicle,
    scheduledAt: f.slots[0].toISOString(),
    consent: true as const,
    notes: "",
  };
  const actor = { clerkId: f.user.clerkId, userId: String(f.user._id) };
  const first = await legacyReservation(await createBooking({ ...input, scheduledAt: f.slots[1].toISOString() }, actor));
  const second = await legacyReservation(await createBooking({ ...input, scheduledAt: f.slots[2].toISOString() }, actor));
  const result = await Promise.allSettled([first, second].map(appointment =>
    changeAppointment(String(appointment._id), { action: "reschedule", scheduledAt: input.scheduledAt }, "admin")));
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const slot = await Slot.findOne({ key: input.scheduledAt });
  assert.equal(slot.used, 1);
});
test("Concluir 10ª lavagem cria uma receita e um cupom, repetição não duplica", async () => {
  const f = await fixture(9);
  const a = await createBooking(
    {
      serviceId: String(f.service._id),
      vehicle,
      scheduledAt: f.slots[1].toISOString(),
      consent: true,
      notes: "",
    },
    { clerkId: f.user.clerkId, userId: String(f.user._id) },
  );
  await approve(String(a._id));
  await prepareReady(String(a._id));
  await changeAppointment(
    String(a._id),
    { action: "complete", finalPrice: 50, paymentMethod: "pix" },
    "admin",
  );
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 0);
  const coupon = await Coupon.findOne({ userId: f.user._id });
  assert.equal(coupon.vehiclePlate, "ABC1D23");
  assert.equal(+coupon.expiresAt - +coupon.issuedAt, 30 * 86400000);
  await assert.rejects(() =>
    changeAppointment(
      String(a._id),
      { action: "complete", finalPrice: 50, paymentMethod: "pix" },
      "admin",
    ),
  );
  assert.equal(await Transaction.countDocuments({ appointmentId: a._id }), 1);
  assert.equal(await Coupon.countDocuments({ userId: f.user._id }), 1);
});
test("Cupom não pode ser reservado para outro veículo ou por outro cliente", async () => {
  const f = await fixture();
  const coupon = await Coupon.create({
    userId: f.user._id,
    vehiclePlate: vehicle.plate,
    vehicleType: "small",
    issuedAt: new Date(),
    expiresAt: expiryForReward(new Date()),
    issueKey: `test-${new mongoose.Types.ObjectId()}`,
  });
  const input = {
    serviceId: String(f.service._id),
    vehicle: { ...vehicle, plate: "XYZ1234" },
    scheduledAt: f.slots[2].toISOString(),
    consent: true as const,
    notes: "",
    couponId: String(coupon._id),
  };
  await assert.rejects(() =>
    createBooking(input, {
      clerkId: f.user.clerkId,
      userId: String(f.user._id),
    }),
  );
  const other = await User.create({ clerkId: "other-test", name: "Outro" });
  await assert.rejects(() =>
    createBooking(
      { ...input, vehicle },
      { clerkId: other.clerkId, userId: String(other._id) },
    ),
  );
  assert.equal(await Slot.countDocuments({ key: input.scheduledAt }), 0);
});
test("Cortesia gera R$ 0 e não soma pontos; cancelar devolve reserva", async () => {
  const f = await fixture(3);
  const coupon = await Coupon.create({
    userId: f.user._id,
    vehiclePlate: vehicle.plate,
    vehicleType: "small",
    issuedAt: new Date(),
    expiresAt: expiryForReward(new Date()),
    issueKey: `test-${new mongoose.Types.ObjectId()}`,
  });
  const input = {
    serviceId: String(f.service._id),
    vehicle,
    scheduledAt: f.slots[3].toISOString(),
    consent: true as const,
    notes: "",
    couponId: String(coupon._id),
  };
  const actor = { clerkId: f.user.clerkId, userId: String(f.user._id) };
  const first = await createBooking(input, actor);
  await changeAppointment(
    String(first._id),
    { action: "cancel", reason: "Teste" },
    "admin",
  );
  assert.equal(
    (await Coupon.findById(coupon._id)).reservedAppointmentId,
    undefined,
  );
  const a = await createBooking(input, actor);
  await approve(String(a._id));
  await prepareReady(String(a._id));
  await changeAppointment(
    String(a._id),
    { action: "complete", finalPrice: 999, paymentMethod: "cash" },
    "admin",
  );
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 3);
  assert.equal((await Transaction.findOne({ appointmentId: a._id })).amount, 0);
  assert.equal((await Coupon.findById(coupon._id)).status, "used");
  await assert.rejects(() =>
    createBooking({ ...input, scheduledAt: f.slots[4].toISOString() }, actor),
  );
});
test("Ajustes de fidelidade exigem ciclo válido e geram trilha de auditoria", async () => {
  const f = await fixture(2);
  await adjustPoints(String(f.user._id), 2, "Correção de registro", "admin");
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 4);
  assert.equal(await Audit.countDocuments({ userId: f.user._id }), 1);
  await assert.rejects(() =>
    adjustPoints(String(f.user._id), 9, "Ajuste inválido", "admin"),
  );
});
test("Bloqueio de horário protege reagendamento legado e não restringe novas solicitações", async () => {
  const f = await fixture();
  await Slot.updateOne(
    { key: f.slots[5].toISOString() },
    { $set: { blocked: true }, $setOnInsert: { used: 0 } },
    { upsert: true },
  );
  const slots = await availableSlots(localDate(f.slots[5]));
  assert.equal(
    slots.find((s) => s.scheduledAt === f.slots[5].toISOString())?.available,
    false,
  );
  const input = { serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[5].toISOString(), consent: true as const, notes: "" };
  const actor = { clerkId: f.user.clerkId, userId: String(f.user._id) };
  const free = await createBooking(input, actor);
  assert.equal(free.flexibleSchedule, true);
  const legacy = await legacyReservation(await createBooking({ ...input, scheduledAt: f.slots[0].toISOString() }, actor));
  await assert.rejects(changeAppointment(String(legacy._id), { action: "reschedule", scheduledAt: f.slots[5].toISOString() }, "admin"), /bloqueado/);
});
test("Financeiro e Excel respeitam os mesmos filtros e têm três abas", async () => {
  await Transaction.create({
    date: new Date(),
    description: "PPF teste",
    category: "PPF",
    source: "manual",
    amount: 1200.25,
    paymentMethod: "card",
    createdBy: "admin",
  });
  const filter = {
    from: new Date(Date.now() - 86400000),
    to: new Date(Date.now() + 86400000),
    category: "PPF",
    paymentMethod: "card",
  };
  const summary = await financeSummary(filter);
  assert.equal(summary.total, 1200.25);
  assert.equal(summary.count, 1);
  const output = await financeWorkbook(filter);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output as never);
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    ["Resumo", "Entradas", "Por serviço"],
  );
  assert.equal(workbook.getWorksheet("Entradas")?.getCell("F2").value, 1200.25);
});
test("Capacidade individual de vaga legada aceita somente dois reagendamentos concorrentes", async () => {
  const f = await fixture();
  const time = f.slots[6].toISOString();
  await Slot.updateOne(
    { key: time },
    { $set: { capacity: 2, blocked: false }, $setOnInsert: { used: 0 } },
    { upsert: true },
  );
  const input = {
    serviceId: String(f.service._id),
    vehicle,
    scheduledAt: time,
    consent: true as const,
    notes: "",
  };
  const actor = { clerkId: f.user.clerkId, userId: String(f.user._id) };
  const old = [];
  for (const index of [0, 1, 2]) old.push(await legacyReservation(await createBooking({ ...input, scheduledAt: f.slots[index].toISOString() }, actor)));
  const results = await Promise.allSettled(old.map(appointment => changeAppointment(String(appointment._id), { action: "reschedule", scheduledAt: time }, "admin")));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal((await Slot.findOne({ key: time })).used, 2);
});
test("Duas solicitações concorrentes não conseguem reservar o mesmo cupom", async () => {
  const f = await fixture();
  const coupon = await Coupon.create({
    userId: f.user._id,
    vehiclePlate: vehicle.plate,
    vehicleType: vehicle.type,
    issuedAt: new Date(),
    expiresAt: expiryForReward(new Date()),
    issueKey: `test-${new mongoose.Types.ObjectId()}`,
  });
  const base = {
    serviceId: String(f.service._id),
    vehicle,
    consent: true as const,
    notes: "",
    couponId: String(coupon._id),
  };
  const actor = { clerkId: f.user.clerkId, userId: String(f.user._id) };
  const results = await Promise.allSettled([
    createBooking({ ...base, scheduledAt: f.slots[7].toISOString() }, actor),
    createBooking({ ...base, scheduledAt: f.slots[8].toISOString() }, actor),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await Appointment.countDocuments({ couponId: coupon._id }), 1);
});
test("CLI de seed executa e preserva preços já editados",async()=>{
  const service=await Service.findOne({slug:"externa"});await Service.updateOne({_id:service._id},{$set:{"prices.small":31}});
  try {
    const result=spawnSync(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/seed.ts"],{env:process.env,encoding:"utf8",timeout:30000});
    assert.equal(result.status,0,result.stdout+result.stderr);assert.equal((await Service.findById(service._id)).prices.small,31);
  } finally {await Service.updateOne({_id:service._id},{$set:{"prices.small":30}});}
});

test("Serviço à parte (Outros): agendamento manual com descrição e valor, fora da fidelidade", async () => {
  const f = await fixture(9);
  const appt = await createBooking(
    manualEstimate({
      vehicle,
      scheduledAt: f.slots[1].toISOString(),
      notes: "",
      userId: String(f.user._id),
      custom: { description: "Polimento à parte", price: 480 },
    }),
    { clerkId: "admin-test" },
    true,
  );
  assert.equal(appt.serviceName, "Outros: Polimento à parte");
  assert.equal(appt.quotedPrice, 480);
  assert.equal(appt.status, "confirmed");
  assert.equal(appt.countsForLoyalty, false);
  assert.equal(appt.serviceId, undefined);
  await assert.rejects(changeAppointment(String(appt._id),
    { action: "complete", finalPrice: 520, paymentMethod: "pix" }, "admin-test"),
    /Marque como pronto/);
  await prepareReady(String(appt._id));
  const done = await changeAppointment(
    String(appt._id),
    { action: "complete", finalPrice: 520, paymentMethod: "pix" },
    "admin-test",
  );
  assert.equal(done.status, "completed");
  assert.equal(done.finalPrice, 520);
  const revenues = await Transaction.find({ appointmentId: appt._id });
  assert.equal(revenues.length, 1);
  assert.equal(revenues[0].amount, 520);
  assert.equal(revenues[0].category, "extra");
  assert.equal(revenues[0].source, "appointment");
  assert.equal((await User.findById(f.user._id)).loyaltyCount, 9);
  assert.equal((await User.findById(f.user._id)).totalWashes, 0);
  assert.equal(await Coupon.countDocuments({ userId: f.user._id }), 0);
  await assert.rejects(changeAppointment(String(appt._id),
    { action: "complete", finalPrice: 520, paymentMethod: "pix" }, "admin-test"));
  assert.equal(await Transaction.countDocuments({ appointmentId: appt._id }), 1);
});

test("Controle agrega o período completo, distingue etapas e respeita o dia local", async () => {
  const date = new Date("2040-02-06T15:00:00Z");
  const docs = Array.from({ length: 65 }, () => ({ vehicle, scheduledAt: date, status: "confirmed", quotedPrice: 0.1 }));
  await Appointment.insertMany([
    ...docs,
    { vehicle, scheduledAt: date, status: "confirmed", quotedPrice: 100, couponId: new mongoose.Types.ObjectId() },
    { vehicle, scheduledAt: date, status: "pending", quotedPrice: 100 },
    { vehicle, scheduledAt: date, status: "completed", quotedPrice: 100 },
    { vehicle, scheduledAt: date, status: "cancelled", quotedPrice: 100 },
    { vehicle, scheduledAt: date, status: "rejected", quotedPrice: 100 },
    { vehicle, scheduledAt: new Date("2040-02-07T02:59:59Z"), status: "confirmed", quotedPrice: 0.2 },
    { vehicle, scheduledAt: new Date("2040-02-07T03:00:00Z"), status: "confirmed", quotedPrice: 999 },
  ]);
  try {
    assert.deepEqual(await controlSummary("2040-02-06"), { total: 71, confirmed: 67, completed: 1, returned:0, receivable: 6.7, periodReceivable:6.7, onSite:1, entered:0, inProgress:0, ready:1, waiting:0, awaitingPayment:0, awaitingPickup:1, physicalReceivable:0 });
    assert.deepEqual(await controlSummary("2040-02-08"), { total: 0, confirmed: 0, completed: 0, returned:0, receivable: 0, periodReceivable:0, onSite:1, entered:0, inProgress:0, ready:1, waiting:0, awaitingPayment:0, awaitingPickup:1, physicalReceivable:0 });
  } finally { await Appointment.deleteMany({ scheduledAt: { $gte: date } }); }
});

test("Catálogo recupera originais sem apagar personalizados nem preços editados", async () => {
  await Service.create({name:"Teste personalizado",slug:"teste-custom",category:"extra",active:true});
  await Service.deleteOne({slug:"extra-0"});
  await Service.updateOne({slug:"externa"},{$set:{"prices.small":37,active:false}});
  await seedCatalog(); await seedCatalog();
  assert.equal(await Service.countDocuments({slug:"extra-0"}),1);
  assert.ok(await Service.exists({slug:"teste-custom"}));
  const external=await Service.findOne({slug:"externa"});
  assert.equal(external.prices.small,37);assert.equal(external.active,false);
});

test("Moto sob orçamento, horário livre e etapas operacionais preservam contagem", async () => {
  const f=await fixture(); const service=await Service.findOne({slug:"moto"});
  const day=localDate(addDays(new Date(),12));
  let times=localSlots(day,defaultSettings);
  if(!times.length) times=localSlots(localDate(addDays(new Date(),13)),defaultSettings);
  const desired=new Date(+times[0]+17*60000);
  const input={serviceId:String(service._id),vehicle:{model:"Honda CG",plate:"MOT1A23",type:"moto" as const},scheduledAt:desired.toISOString(),consent:true as const,notes:""};
  const actor={clerkId:f.user.clerkId,userId:String(f.user._id)};
  const booking=await createBooking(input,actor);
  assert.equal(booking.quotedPrice,null);assert.equal(booking.slotKey,undefined);assert.equal(booking.flexibleSchedule,true);
  await createBooking({...input,scheduledAt:new Date(+times[0]+29*60000).toISOString()},actor);
  await changeAppointment(String(booking._id),{action:"reschedule",scheduledAt:new Date(+times[0]+25*60000).toISOString()},"admin-test");
  await approve(String(booking._id),"admin-test");
  await assert.rejects(()=>changeAppointment(String(booking._id),{action:"start"},"admin-test"),/Etapa/);
  await changeAppointment(String(booking._id),{action:"arrive"},"admin-test");
  await changeAppointment(String(booking._id),{action:"start"},"admin-test");
  let summary=await controlSummary(localDate(new Date()));assert.equal(summary.onSite,1);assert.equal(summary.inProgress,1);
  await changeAppointment(String(booking._id),{action:"ready"},"admin-test");
  await changeAppointment(String(booking._id),{action:"complete",finalPrice:25,paymentMethod:"pix"},"admin-test");
  await changeAppointment(String(booking._id),{action:"deliver"},"admin-test");
  summary=await controlSummary(localDate(new Date()));assert.equal(summary.onSite,0);assert.equal(summary.entered,1);
  assert.equal(await Transaction.countDocuments({appointmentId:booking._id}),1);
});

test("Cadastro incompleto não consegue reservar pela regra do servidor", async () => {
  const f = await fixture();
  await User.updateOne({_id:f.user._id}, {$unset:{phone:1}});
  await assert.rejects(createBooking({serviceId:String(f.service._id), vehicle, scheduledAt:f.slots[0].toISOString(), consent:true, notes:""},
    {clerkId:f.user.clerkId,userId:String(f.user._id)}), (error:unknown) => error instanceof AppError && error.status === 409 && /Meu perfil/.test(error.message));
  assert.equal(await Appointment.countDocuments({userId:f.user._id}),0);
  assert.equal(await Slot.countDocuments({key:f.slots[0].toISOString()}),0);
});

test("Fila é FIFO por chegada, inclui dias anteriores e entrega remove somente o veículo entregue", async () => {
  const f=await fixture();
  const actor={clerkId:"admin",userId:String(f.user._id)};
  const create=(slot:number)=>createBooking(manualEstimate({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[slot].toISOString(),userId:String(f.user._id),notes:""}),actor,true);
  const earlierScheduled=await create(0), laterScheduled=await create(1);
  await create(2); // Confirmed planning is not part of the physical queue.
  await changeAppointment(String(laterScheduled._id),{action:"arrive"},"admin");
  await changeAppointment(String(earlierScheduled._id),{action:"arrive"},"admin");
  await Appointment.updateOne({_id:laterScheduled._id},{$set:{arrivedAt:new Date(Date.now()-2*86400000)}});
  await Appointment.updateOne({_id:earlierScheduled._id},{$set:{arrivedAt:new Date(Date.now()-86400000)}});
  let queue=await operationalQueue();
  assert.equal(queue.total,2);
  assert.deepEqual(queue.items.map(item=>String(item._id)),[String(laterScheduled._id),String(earlierScheduled._id)]);
  assert.equal(queue.items[0].clientPhone,"5585999991234");
  for(const action of ["start","ready"] as const) await changeAppointment(String(laterScheduled._id),{action},"admin");
  await changeAppointment(String(laterScheduled._id),{action:"complete",finalPrice:50,paymentMethod:"pix"},"admin");
  const beforeDelivery=await controlSummary(localDate(new Date()));
  assert.equal(beforeDelivery.onSite,2); assert.equal(beforeDelivery.waiting,1);assert.equal(beforeDelivery.awaitingPickup,1);
  await changeAppointment(String(laterScheduled._id),{action:"deliver"},"admin");
  queue=await operationalQueue();
  assert.equal(queue.total,1);assert.equal(String(queue.items[0]._id),String(earlierScheduled._id));
  assert.equal((await Appointment.findById(laterScheduled._id)).status,"delivered");
});

test("Pagamento antecipado exige todas as etapas e libera a vaga com auditoria", async () => {
  const f=await fixture();
  const appointment=await legacyReservation(await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)}));
  const id=String(appointment._id);
  await approve(id);
  await assert.rejects(changeAppointment(id,{action:"complete",finalPrice:50,paymentMethod:"pix"},"admin"),(error:unknown)=>error instanceof AppError && error.status===409);
  assert.equal(await Transaction.countDocuments({appointmentId:id}),0);
  await prepareReady(id);
  const done=await changeAppointment(id,{action:"complete",finalPrice:50,paymentMethod:"pix"},"admin");
  assert.ok(done.completedAt<done.scheduledAt);
  assert.ok(done.confirmedAt && done.arrivedAt && done.startedAt && done.readyAt && done.slotReleasedAt);
  assert.equal((await Slot.findOne({key:appointment.slotKey})).used,0);
  await changeAppointment(id,{action:"deliver"},"admin");
  const audits=await Audit.find({appointmentId:id}).sort({createdAt:1});
  assert.deepEqual(audits.map(a=>a.action),["booking_created","confirm","arrive","start","ready","complete","deliver"]);
  const cancelled=await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)});
  await changeAppointment(String(cancelled._id),{action:"cancel"},"admin");
  assert.equal((await Slot.findOne({key:appointment.slotKey})).used,0);
  await assert.rejects(changeAppointment(id,{action:"arrive"},"admin"),/Etapa/);
});

test("Conclusões concorrentes e repetidas criam uma receita e um único prêmio", async () => {
  const f=await fixture(9);
  const appointment=await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)});
  const id=String(appointment._id);await prepareReady(id);
  const result=await Promise.allSettled([1,2].map(()=>changeAppointment(id,{action:"complete",finalPrice:50,paymentMethod:"card"},"admin")));
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  const failure=result.find(r=>r.status==="rejected") as PromiseRejectedResult;
  assert.ok(failure.reason instanceof AppError);assert.equal(failure.reason.status,409);
  await assert.rejects(changeAppointment(id,{action:"complete",finalPrice:75,paymentMethod:"cash"},"admin"),/já pode ter sido registrado/);
  assert.equal(await Transaction.countDocuments({appointmentId:id}),1);
  assert.equal(await Coupon.countDocuments({issueKey:`appointment:${id}`}),1);
  assert.equal((await User.findById(f.user._id)).loyaltyCount,0);
  assert.equal((await User.findById(f.user._id)).totalWashes,1);
  assert.equal((await Transaction.findOne({appointmentId:id})).amount,50);
  assert.equal(await Audit.countDocuments({appointmentId:id,action:"complete"}),1);
});

test("Falha ao gravar receita reverte etapa, cupom, pontos, vaga e auditoria", async () => {
  const f=await fixture(3);
  const coupon=await Coupon.create({userId:f.user._id,vehiclePlate:vehicle.plate,vehicleType:vehicle.type,issuedAt:new Date(),expiresAt:expiryForReward(new Date()),issueKey:`rollback-${new mongoose.Types.ObjectId()}`});
  const appointment=await legacyReservation(await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:"",couponId:String(coupon._id)},{clerkId:f.user.clerkId,userId:String(f.user._id)}));
  const id=String(appointment._id);await prepareReady(id);
  const conflicting=await Transaction.create({appointmentId:id,date:new Date(),description:"Conflito de teste",category:"wash",source:"appointment",amount:7,paymentMethod:"cash"});
  await assert.rejects(changeAppointment(id,{action:"complete",finalPrice:50,paymentMethod:"pix"},"admin"));
  let stored=await Appointment.findById(id);
  assert.equal(stored.status,"ready");assert.equal(stored.completedAt,undefined);assert.equal(stored.slotReleasedAt,undefined);
  assert.equal((await User.findById(f.user._id)).loyaltyCount,3);assert.equal((await User.findById(f.user._id)).totalWashes,0);
  assert.equal((await Coupon.findById(coupon._id)).status,"available");
  assert.equal(String((await Coupon.findById(coupon._id)).reservedAppointmentId),id);
  assert.equal((await Slot.findOne({key:appointment.slotKey})).used,1);
  assert.equal(await Audit.countDocuments({appointmentId:id,action:"complete"}),0);
  await Transaction.deleteOne({_id:conflicting._id});
  stored=await changeAppointment(id,{action:"complete",finalPrice:999,paymentMethod:"pix"},"admin");
  assert.equal(stored.finalPrice,0);assert.equal((await Transaction.findOne({appointmentId:id})).amount,0);
  assert.equal((await Coupon.findById(coupon._id)).status,"used");
  assert.equal((await User.findById(f.user._id)).loyaltyCount,3);
});

test("Falha financeira na décima lavagem reverte os pontos e a emissão do prêmio", async () => {
  const f=await fixture(9);
  const appointment=await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)});
  const id=String(appointment._id);await prepareReady(id);
  const conflicting=await Transaction.create({appointmentId:id,date:new Date(),description:"Conflito teste décima",category:"wash",source:"appointment",amount:7,paymentMethod:"cash"});
  await assert.rejects(changeAppointment(id,{action:"complete",finalPrice:50,paymentMethod:"pix"},"admin"));
  assert.equal((await User.findById(f.user._id)).loyaltyCount,9);assert.equal((await User.findById(f.user._id)).totalWashes,0);
  assert.equal(await Coupon.countDocuments({issueKey:`appointment:${id}`}),0);
  assert.equal((await Appointment.findById(id)).status,"ready");
  assert.equal(await Audit.countDocuments({appointmentId:id,action:"complete"}),0);
  await Transaction.deleteOne({_id:conflicting._id});
  await changeAppointment(id,{action:"complete",finalPrice:50,paymentMethod:"pix"},"admin");
  assert.equal((await User.findById(f.user._id)).loyaltyCount,0);assert.equal((await User.findById(f.user._id)).totalWashes,1);
  assert.equal(await Coupon.countDocuments({issueKey:`appointment:${id}`}),1);
});

test("Lavagem com valor final zero não gera pontos nem conta como lavagem paga", async () => {
  const f=await fixture(9);
  const appointment=await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)});
  const id=String(appointment._id);await prepareReady(id);
  await changeAppointment(id,{action:"complete",finalPrice:0,paymentMethod:"pix"},"admin");
  assert.equal((await User.findById(f.user._id)).loyaltyCount,9);assert.equal((await User.findById(f.user._id)).totalWashes,0);
  assert.equal(await Coupon.countDocuments({issueKey:`appointment:${id}`}),0);
  assert.equal((await Transaction.findOne({appointmentId:id})).amount,0);
});

test("Reagendar e cancelar liberam a vaga correta e a reserva do cupom", async () => {
  const f=await fixture();
  const coupon=await Coupon.create({userId:f.user._id,vehiclePlate:vehicle.plate,vehicleType:vehicle.type,issuedAt:new Date(),expiresAt:expiryForReward(new Date()),issueKey:`reschedule-${new mongoose.Types.ObjectId()}`});
  const appointment=await legacyReservation(await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:"",couponId:String(coupon._id)},{clerkId:f.user.clerkId,userId:String(f.user._id)}));
  const id=String(appointment._id);
  await changeAppointment(id,{action:"reschedule",scheduledAt:f.slots[1].toISOString()},"admin");
  assert.equal((await Slot.findOne({key:f.slots[0].toISOString()})).used,0);assert.equal((await Slot.findOne({key:f.slots[1].toISOString()})).used,1);
  assert.equal(String((await Coupon.findById(coupon._id)).reservedAppointmentId),id);
  await changeAppointment(id,{action:"cancel",reason:"Desistência"},"admin");
  assert.equal((await Slot.findOne({key:f.slots[1].toISOString()})).used,0);
  assert.equal((await Coupon.findById(coupon._id)).reservedAppointmentId,undefined);
  assert.ok((await Appointment.findById(id)).cancelledAt);
  await assert.rejects(changeAppointment(id,{action:"cancel"},"admin"),/Etapa/);
});

test("Receita usa data real local, placa e referência nos filtros diário, mensal e Excel", async () => {
  const f=await fixture();
  const appointment=await createBooking({serviceId:String(f.service._id),vehicle,scheduledAt:f.slots[0].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)});
  const id=String(appointment._id);await prepareReady(id);
  const done=await changeAppointment(id,{action:"complete",finalPrice:50.25,paymentMethod:"pix"},"admin");
  const daily={...periodBounds("day",localDate(done.completedAt)),paymentMethod:"pix",category:"wash"};
  const monthly={...periodBounds("month",localDate(done.completedAt)),paymentMethod:"pix",category:"wash"};
  assert.equal((await financeSummary(daily)).total,50.25);assert.equal((await financeSummary(monthly)).count,1);
  assert.equal((await financeSummary({...periodBounds("day",localDate(done.scheduledAt))})).count,0);
  const entry=await Transaction.findOne({appointmentId:id});
  assert.equal(+entry.date,+done.completedAt);assert.equal(entry.vehiclePlate,vehicle.plate);assert.equal(entry.paymentMethod,"pix");
  const book=new ExcelJS.Workbook();await book.xlsx.load(await financeWorkbook(daily) as never);
  assert.equal(book.getWorksheet("Entradas")?.getCell("F2").value,50.25);
  assert.equal(book.getWorksheet("Entradas")?.getCell("H2").value,vehicle.plate);
  assert.equal(book.getWorksheet("Entradas")?.getCell("J2").value,id);
});

test("Chegada sem agendamento entra imediatamente na fila sem consumir vaga", async () => {
  const f=await fixture();
  const input=manualBookingSchema.parse({walkIn:true,guestName:"Cliente Avulso",guestPhone:"(85) 99999-1234",vehicle,custom:{description:"Polimento avulso",price:350},notes:""});
  const appointment=await createBooking(manualEstimate(input),{clerkId:"admin"},true);
  assert.equal(appointment.status,"arrived");assert.ok(appointment.arrivedAt);assert.equal(appointment.slotKey,undefined);
  assert.equal(await Slot.countDocuments({}),0);
  assert.equal((await operationalQueue()).items[0].clientPhone,"5585999991234");
  const control=await controlSummary(localDate(appointment.arrivedAt));
  assert.equal(control.total,1);assert.equal(control.confirmed,0);
  assert.equal(control.entered,1);assert.equal(control.onSite,1);assert.equal(control.waiting,1);
  for(const action of ["start","ready"] as const) await changeAppointment(String(appointment._id),{action},"admin");
  await changeAppointment(String(appointment._id),{action:"complete",finalPrice:350,paymentMethod:"cash"},"admin");
  assert.equal(await Slot.countDocuments({}),0);assert.equal((await Transaction.findOne({appointmentId:appointment._id})).clientName,"Cliente Avulso");
  assert.equal(await Coupon.countDocuments({}),0);
});

test("Salvar o mesmo veículo atualiza o modelo sem duplicar a placa", async () => {
  const f=await fixture();
  for(const [index,model] of ["Onix","Onix LTZ"].entries()) await createBooking({serviceId:String(f.service._id),vehicle:{...vehicle,model},scheduledAt:f.slots[index].toISOString(),consent:true,notes:""},{clerkId:f.user.clerkId,userId:String(f.user._id)});
  const user=await User.findById(f.user._id);
  assert.equal(user.vehicles.length,1);assert.equal(user.vehicles[0].model,"Onix LTZ");
});

test("Agendar outra placa mantém no máximo os vinte veículos mais recentes", async () => {
  const f = await fixture();
  const saved = Array.from({ length: 20 }, (_, index) => ({ ...vehicle, plate: `OLD1A${String(index).padStart(2, "0")}` }));
  await User.updateOne({ _id: f.user._id }, { $set: { vehicles: saved } });
  const booking = await createBooking({
    serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(), consent: true, notes: "",
  }, { clerkId: f.user.clerkId, userId: String(f.user._id) });
  const user = await User.findById(f.user._id).lean();
  assert.equal(user.vehicles.length, 20);
  assert.equal(user.vehicles.at(-1).plate, vehicle.plate);
  assert.equal(user.vehicles.some((item: typeof vehicle) => item.plate === saved[0].plate), false);
  assert.equal((await Appointment.findById(booking._id)).vehicle.plate, vehicle.plate);
});

test("Cliente solicita madrugada de domingo em qualquer minuto sem ocupar a agenda legada", async () => {
  const f = await fixture();
  let day = addDays(new Date(), 1);
  while (day.getUTCDay() !== 0) day = addDays(day, 1);
  const scheduledAt = `${localDate(day)}T02:17:00-03:00`;
  const actor = { clerkId: f.user.clerkId, userId: String(f.user._id) };
  const input = { serviceId: String(f.service._id), vehicle, scheduledAt, consent: true as const, notes: "" };
  const first = await createBooking(input, actor);
  const second = await createBooking(input, actor);
  assert.equal(first.status, "pending");
  assert.equal(first.flexibleSchedule, true);
  assert.equal(first.slotKey, undefined);
  assert.equal(first.estimatedCompletionAt, undefined);
  assert.equal(+first.scheduledAt, +new Date(scheduledAt));
  assert.notEqual(String(first._id), String(second._id));
  assert.equal(await Slot.countDocuments(), 0);
  await changeAppointment(String(first._id), { action: "cancel" }, "admin");
  assert.equal(await Slot.countDocuments(), 0);
  for (const value of [new Date(Date.now() - 60000).toISOString(), "invalid"])
    await assert.rejects(createBooking({ ...input, scheduledAt: value }, actor), /futuros/);
});

test("Aprovação grava previsão futura após horário solicitado e audit na mesma transação", async () => {
  const f = await fixture();
  const booking = await createBooking({ serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(), consent: true, notes: "" }, { clerkId: f.user.clerkId, userId: String(f.user._id) });
  const id = String(booking._id);
  for (const estimatedCompletionAt of [new Date(Date.now() - 1000).toISOString(), new Date(+booking.scheduledAt - 60000).toISOString()])
    await assert.rejects(changeAppointment(id, { action: "confirm", estimatedCompletionAt }, "admin"), /previsão de entrega/);
  await assert.rejects(changeAppointment(id, { action: "confirm" } as never, "admin"));
  assert.equal((await Appointment.findById(id)).status, "pending");
  assert.equal(await Audit.countDocuments({ appointmentId: id, action: "confirm" }), 0);
  const estimate = new Date(+booking.scheduledAt + 3600000).toISOString();
  const original = Audit.create;
  Audit.create = async () => { throw new Error("confirm-audit-failure"); };
  try { await assert.rejects(changeAppointment(id, { action: "confirm", estimatedCompletionAt: estimate }, "admin"), /confirm-audit-failure/); }
  finally { Audit.create = original; }
  const reverted = await Appointment.findById(id);
  assert.equal(reverted.status, "pending");
  assert.equal(reverted.estimatedCompletionAt, undefined);
  const results = await Promise.allSettled([1, 2].map(() => changeAppointment(id, { action: "confirm", estimatedCompletionAt: estimate }, "admin")));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const approved = await Appointment.findById(id);
  assert.equal(approved.status, "confirmed");
  assert.equal(approved.estimatedCompletionAt.toISOString(), estimate);
  const audit = await Audit.findOne({ appointmentId: id, action: "confirm" });
  assert.equal(audit.adminClerkId, "admin");
  assert.equal(audit.estimatedCompletionBefore, undefined);
  assert.equal(audit.estimatedCompletionAfter.toISOString(), estimate);
  assert.equal(await Audit.countDocuments({ appointmentId: id, action: "confirm" }), 1);
  assert.equal(await Slot.countDocuments(), 0);
});

test("Reagendamento livre confirmado exige previsão válida e não troca ou reserva vaga", async () => {
  const f = await fixture();
  const booking = await createBooking({ serviceId: String(f.service._id), vehicle, scheduledAt: f.slots[0].toISOString(), consent: true, notes: "" }, { clerkId: f.user.clerkId, userId: String(f.user._id) });
  const id = String(booking._id);
  const first = new Date(+booking.scheduledAt + 2 * 86400000 + 17 * 60000);
  await changeAppointment(id, { action: "reschedule", scheduledAt: first.toISOString() }, "admin");
  assert.equal(+(await Appointment.findById(id)).scheduledAt, +first);
  await approve(id);
  const previousEstimate = (await Appointment.findById(id)).estimatedCompletionAt;
  const next = new Date(+first + 2 * 86400000 + 23 * 60000);
  await assert.rejects(changeAppointment(id, { action: "reschedule", scheduledAt: next.toISOString() }, "admin"), /nova previsão/);
  const invalidEstimate = new Date(+next - 60000).toISOString();
  await assert.rejects(changeAppointment(id, { action: "reschedule", scheduledAt: next.toISOString(), estimatedCompletionAt: invalidEstimate }, "admin"), /previsão/);
  assert.equal(+(await Appointment.findById(id)).scheduledAt, +first);
  const estimatedCompletionAt = new Date(+next + 3600000).toISOString();
  const updated = await changeAppointment(id, { action: "reschedule", scheduledAt: next.toISOString(), estimatedCompletionAt }, "admin");
  assert.equal(updated.status, "confirmed");
  assert.equal(+updated.scheduledAt, +next);
  assert.equal(updated.estimatedCompletionAt.toISOString(), estimatedCompletionAt);
  assert.equal(updated.slotKey, undefined);
  const audit = await Audit.findOne({ appointmentId: id, action: "reschedule", scheduledAfter: next });
  assert.equal(+audit.estimatedCompletionBefore, +previousEstimate);
  assert.equal(audit.estimatedCompletionAfter.toISOString(), estimatedCompletionAt);
  assert.equal(await Slot.countDocuments(), 0);
});

test("Cadastro administrativo exige previsão para confirmar e valida horário livre no servidor", async () => {
  const f = await fixture();
  const scheduledAt = new Date(Date.now() + 3 * 86400000 + 17 * 60000).toISOString();
  const estimatedCompletionAt = new Date(+new Date(scheduledAt) + 3600000).toISOString();
  const input = { vehicle, serviceId: String(f.service._id), guestName: "Cliente avulso", scheduledAt, notes: "" };
  assert.throws(() => manualBookingSchema.parse(input), /previsão/);
  await assert.rejects(createBooking(input, { clerkId: "admin" }, true), /previsão/);
  const withEstimate = await createBooking(manualBookingSchema.parse({ ...input, estimatedCompletionAt }), { clerkId: "admin" }, true);
  assert.equal(withEstimate.status, "confirmed");
  assert.equal(withEstimate.flexibleSchedule, true);
  assert.equal(withEstimate.estimatedCompletionAt.toISOString(), estimatedCompletionAt);
  for (const value of [new Date(Date.now() - 1000).toISOString(), new Date(+new Date(scheduledAt) - 1000).toISOString()])
    await assert.rejects(createBooking(manualBookingSchema.parse({ ...input, estimatedCompletionAt: value }), { clerkId: "admin" }, true), /previsão/);
  assert.equal(await Appointment.countDocuments(), 1);
  assert.equal(await Slot.countDocuments(), 0);
});
