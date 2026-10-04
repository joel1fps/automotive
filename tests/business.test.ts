import { after, before, test } from "node:test";
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
  connectDB,
} from "../src/lib/db";
import { expiryForReward, localDate, localSlots } from "../src/lib/domain";
import { defaultSettings } from "../src/lib/catalog";
import { settingsSchema } from "../src/lib/validation";
import { financeSummary, financeWorkbook } from "../src/lib/finance";
import { controlSummary } from "../src/lib/control";
import ExcelJS from "exceljs";
import { spawnSync } from "node:child_process";
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
const vehicle = { model: "Onix", plate: "ABC1D23", type: "small" as const };
async function fixture(points = 0) {
  const user = await User.create({
    clerkId: `test-${new mongoose.Types.ObjectId()}`,
    name: "Cliente Teste",
    loyaltyCount: points,
  });
  const service = await Service.findOne({ slug: "simples" });
  let day = addDays(new Date(), 4);
  while (!localSlots(localDate(day), defaultSettings).length)
    day = addDays(day, 1);
  return { user, service, slots: localSlots(localDate(day), defaultSettings) };
}
async function past(id: string) {
  const a = await Appointment.findById(id);
  const date = new Date(Date.now() - 3600000);
  await Slot.updateOne(
    { key: a.scheduledAt.toISOString() },
    { $inc: { used: -1 } },
  );
  await Slot.updateOne(
    { key: date.toISOString() },
    { $setOnInsert: { used: 1, blocked: false } },
    { upsert: true },
  );
  await Appointment.updateOne({ _id: id }, { $set: { scheduledAt: date } });
}
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
test("Alteração da grade e reserva concorrentes não ocupam uma grade antiga", async () => {
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
    assert.equal([changed, booked].filter(result => result.status === "fulfilled").length, 1);
    const settings = await getSettings();
    const appointment = await Appointment.findOne({ userId: f.user._id });
    if (booked.status === "fulfilled") {
      assert.equal(settings.openTime, "08:00");
      assert.equal(appointment.slotKey, f.slots[0].toISOString());
    } else {
      assert.equal(settings.openTime, "08:15");
      assert.equal(appointment, null);
      assert.equal((await Slot.findOne({ key: f.slots[0].toISOString() }))?.used || 0, 0);
    }
  } finally {
    await Appointment.deleteMany({ userId: f.user._id });
    await Slot.deleteOne({ key: f.slots[0].toISOString() });
    await User.deleteOne({ _id: f.user._id });
    await updateSettings(input);
  }
});
test("Concorrência: somente uma reserva entra na última vaga", async () => {
  const f = await fixture();
  const input = {
    serviceId: String(f.service._id),
    vehicle,
    scheduledAt: f.slots[0].toISOString(),
    consent: true as const,
    notes: "",
  };
  const result = await Promise.allSettled([
    createBooking(input, {
      clerkId: f.user.clerkId,
      userId: String(f.user._id),
    }),
    createBooking(input, {
      clerkId: f.user.clerkId,
      userId: String(f.user._id),
    }),
  ]);
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
  await changeAppointment(String(a._id), { action: "confirm" }, "admin");
  await past(String(a._id));
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
  assert.equal((await Slot.findOne({ key: input.scheduledAt })).used, 0);
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
  await changeAppointment(String(a._id), { action: "confirm" }, "admin");
  await past(String(a._id));
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
test("Bloqueio de horário impede novas reservas", async () => {
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
  await assert.rejects(() =>
    createBooking(
      {
        serviceId: String(f.service._id),
        vehicle,
        scheduledAt: f.slots[5].toISOString(),
        consent: true,
        notes: "",
      },
      { clerkId: f.user.clerkId, userId: String(f.user._id) },
    ),
  );
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
test("Capacidade individual de dois veículos aceita duas reservas concorrentes", async () => {
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
  const results = await Promise.allSettled([
    createBooking(input, actor),
    createBooking(input, actor),
    createBooking(input, actor),
  ]);
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
    {
      vehicle,
      scheduledAt: f.slots[1].toISOString(),
      notes: "",
      userId: String(f.user._id),
      custom: { description: "Polimento à parte", price: 480 },
    },
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
    /antes do horário agendado/);
  await past(String(appt._id));
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

test("Controle agrega mais de 30 registros, ignora cancelados e cupons e respeita o dia local", async () => {
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
    assert.deepEqual(await controlSummary("2040-02-06"), { total: 69, confirmed: 67, completed: 1, receivable: 6.7, onSite:0, entered:0, inProgress:0, ready:0 });
    assert.deepEqual(await controlSummary("2040-02-08"), { total: 0, confirmed: 0, completed: 0, receivable: 0, onSite:0, entered:0, inProgress:0, ready:0 });
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
  assert.equal(booking.quotedPrice,null);assert.equal(booking.slotKey,times[0].toISOString());
  await assert.rejects(()=>createBooking({...input,scheduledAt:new Date(+times[0]+29*60000).toISOString()},actor),/ocupado/);
  await changeAppointment(String(booking._id),{action:"reschedule",scheduledAt:new Date(+times[0]+25*60000).toISOString()},"admin-test");
  await changeAppointment(String(booking._id),{action:"confirm"},"admin-test");
  await assert.rejects(()=>changeAppointment(String(booking._id),{action:"start"},"admin-test"),/Etapa/);
  await changeAppointment(String(booking._id),{action:"arrive"},"admin-test");
  await changeAppointment(String(booking._id),{action:"start"},"admin-test");
  let summary=await controlSummary(localDate(new Date()));assert.equal(summary.onSite,1);assert.equal(summary.inProgress,1);
  await changeAppointment(String(booking._id),{action:"ready"},"admin-test");
  await Appointment.updateOne({_id:booking._id},{$set:{scheduledAt:new Date(Date.now()-60000)}});
  await changeAppointment(String(booking._id),{action:"complete",finalPrice:25,paymentMethod:"pix"},"admin-test");
  await changeAppointment(String(booking._id),{action:"deliver"},"admin-test");
  summary=await controlSummary(localDate(new Date()));assert.equal(summary.onSite,0);assert.equal(summary.entered,1);
  assert.equal(await Transaction.countDocuments({appointmentId:booking._id}),1);
});
