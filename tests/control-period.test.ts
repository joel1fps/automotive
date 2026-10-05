import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Appointment, User, connectDB } from "../src/lib/db";
import { controlSummary, operationalQueue } from "../src/lib/control";
import { filterBounds, periodBounds } from "../src/lib/domain";
import { appointmentStatuses } from "../src/lib/appointment-state";

let database: MongoMemoryReplSet;
before(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = database.getUri();
  await connectDB();
  await Promise.all([Appointment.init(), User.init()]);
}, { timeout: 60000 });
afterEach(async () => { await Appointment.deleteMany({}); await User.deleteMany({}); });
after(async () => { await mongoose.disconnect(); await database?.stop(); });
const vehicle = { model: "Onix de teste", plate: "FUT1A23", type: "small" };
const record = (scheduledAt: string, status = "confirmed", extra = {}) => ({
  vehicle, scheduledAt: new Date(scheduledAt), status, serviceName: "Lavagem de teste", quotedPrice: 50, ...extra,
});

test("Fila por dia mantém aprovado futuro, inclui todas as etapas e respeita Fortaleza sem expor tokens", async () => {
  const customer = await User.create({ clerkId: "period-fixture-customer", name: "Cliente futuro", phone: "5585999123456" });
  const rows = await Appointment.create(appointmentStatuses.map(status => record("2026-10-05T14:00:00Z", status, {
    userId: customer._id, trackingToken: `secret-tracking-token-${status}`, trackingTokenHash: `secret-tracking-hash-${status}`,
    deletionReason: "private-deletion-reason", flexibleSchedule: true, estimatedCompletionAt: new Date("2026-10-06T02:17:00Z"),
  })));
  await Appointment.create([
    record("2026-10-05T02:59:59.999Z"), record("2026-10-06T03:00:00Z"),
    record("2026-10-05T14:00:00Z", "confirmed", { deletedAt: new Date() }),
  ]);
  const queue = await operationalQueue(periodBounds("day", "2026-10-05"));
  assert.equal(queue.total, appointmentStatuses.length);
  assert.equal(queue.page, 1);
  assert.equal(queue.pages, 1);
  assert.equal(queue.items.length, appointmentStatuses.length);
  for (const row of rows) assert.ok(queue.items.some(item => String(item._id) === String(row._id)), row.status);
  for (const status of appointmentStatuses) assert.equal(queue.counts![status], 1, status);
  const confirmed = queue.items.find(item => item.status === "confirmed")!;
  assert.equal(confirmed.clientName, "Cliente futuro");
  assert.equal(confirmed.clientPhone, customer.phone);
  assert.equal(confirmed.flexibleSchedule, true);
  assert.equal(+confirmed.scheduledAt, +new Date("2026-10-05T14:00:00Z"));
  assert.equal(+confirmed.estimatedCompletionAt, +new Date("2026-10-06T02:17:00Z"));
  const serialized = JSON.stringify(queue);
  for (const value of ["secret-tracking-token", "secret-tracking-hash", "private-deletion-reason"])
    assert.equal(serialized.includes(value), false, value);
  assert.equal(serialized.includes("trackingToken"), false);
});

test("Fila mensal e semanal consultam períodos futuros completos e personalizados incluem último dia", async () => {
  const future = await Appointment.create([
    record("2026-11-01T03:00:00Z", "confirmed"), record("2026-12-01T02:59:59.999Z", "delivered"),
    record("2026-11-05T14:00:00Z", "cancelled"), record("2026-11-06T14:00:00Z", "rejected"),
  ]);
  await Appointment.create([record("2026-11-01T02:59:59.999Z"), record("2026-12-01T03:00:00Z")]);
  const month = await operationalQueue(periodBounds("month", "2026-11-15"));
  assert.equal(month.total, 4);
  assert.deepEqual(new Set(month.items.map(item => String(item._id))), new Set(future.map((item: { _id: mongoose.Types.ObjectId }) => String(item._id))));
  const week = await operationalQueue(periodBounds("week", "2026-11-05"));
  assert.equal(week.total, 2);
  const custom = await operationalQueue(filterBounds("2026-11-05", "2026-11-06"));
  assert.equal(custom.total, 2);
  const summary = await controlSummary("2026-11-15", "month");
  assert.equal(summary.total, 4);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.completed, 1);
});

test("Fila do período pagina todos os registros e conta todas as etapas antes de paginar", async () => {
  await Appointment.insertMany(Array.from({ length: 205 }, (_, index) => record(
    new Date(+new Date("2026-11-01T14:00:00Z") + index * 60000).toISOString(),
  )));
  const bounds = periodBounds("month", "2026-11-01");
  const pages = await Promise.all([1, 2, 3].map(page => operationalQueue({ ...bounds, page })));
  assert.deepEqual(pages.map(page => page.items.length), [100, 100, 5]);
  for (const page of pages) {
    assert.equal(page.total, 205);
    assert.equal(page.pages, 3);
    assert.equal(page.counts!.confirmed, 205);
  }
  const ids = pages.flatMap(page => page.items.map(item => String(item._id)));
  assert.equal(new Set(ids).size, 205);
  const dates = pages.flatMap(page => page.items.map(item => +item.scheduledAt));
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b));
  assert.equal((await operationalQueue({ ...bounds, page: 4 })).items.length, 0);
  await assert.rejects(operationalQueue({ ...bounds, page: 0 }), /Página inválida/);
});

test("Fila física conserva FIFO de dias anteriores e períodos classificam recebidos pela chegada", async () => {
  const [second, first, previous] = await Appointment.create([
    record("2026-11-05T10:00:00Z", "arrived", { arrivedAt: new Date("2026-11-05T15:00:00Z") }),
    record("2026-11-05T14:00:00Z", "arrived", { arrivedAt: new Date("2026-11-05T13:00:00Z") }),
    record("2026-11-03T14:00:00Z", "ready", { arrivedAt: new Date("2026-11-03T13:00:00Z") }),
    record("2026-11-06T14:00:00Z", "confirmed"),
  ]);
  const physical = await operationalQueue();
  assert.equal(physical.total, 3);
  assert.deepEqual(physical.items.map(item => String(item._id)), [previous, first, second].map(item => String(item._id)));
  const day = await operationalQueue(periodBounds("day", "2026-11-05"));
  assert.equal(day.total, 2);
  assert.deepEqual(day.items.map(item => String(item._id)), [first, second].map(item => String(item._id)));
});

test("Valor previsto por período inclui encaixes e exclui pagamento, cortesia, cancelado, excluído e outro dia", async () => {
  await Appointment.create([
    record("2026-11-05T14:00:00Z", "confirmed", { quotedPrice: 50 }),
    record("2026-11-05T14:00:00Z", "arrived", { quotedPrice: 75.5, walkIn: true }),
    record("2026-11-05T14:00:00Z", "ready", { quotedPrice: 29.99 }),
    record("2026-11-05T14:00:00Z", "completed", { quotedPrice: 1000 }),
    record("2026-11-05T14:00:00Z", "cancelled", { quotedPrice: 1000 }),
    record("2026-11-05T14:00:00Z", "ready", { quotedPrice: 1000, couponId: new mongoose.Types.ObjectId() }),
    record("2026-11-05T14:00:00Z", "arrived", { quotedPrice: 10, walkIn: true, deletedAt: new Date() }),
    record("2026-11-06T14:00:00Z", "arrived", { quotedPrice: 99, walkIn: true }),
  ]);
  const day = await controlSummary("2026-11-05");
  assert.equal(day.receivable, 155.49);
  assert.equal(day.periodReceivable, 155.49);
  assert.equal((await controlSummary("2026-11-05", "month")).periodReceivable, 254.49);
});

test("Histórico usa a data real selecionada e resumo conta o mesmo conjunto em todos os critérios", async () => {
  const common = { arrivedAt: new Date("2026-11-02T14:00:00Z"), flexibleSchedule: true };
  const [delivered, returned, ready] = await Appointment.create([
    record("2026-11-01T14:00:00Z", "delivered", { ...common, readyAt: new Date("2026-11-03T14:00:00Z"), deliveredAt: new Date("2026-11-04T14:00:00Z") }),
    record("2026-11-01T14:00:00Z", "returned", { ...common, returnedAt: new Date("2026-11-04T15:00:00Z"), returnReason: "Cliente retirou o veículo sem serviço" }),
    record("2026-11-01T14:00:00Z", "ready", { ...common, readyAt: new Date("2026-11-03T15:00:00Z") }),
    record("2026-11-04T14:00:00Z", "confirmed"),
    record("2026-11-01T14:00:00Z", "delivered", { ...common, readyAt: new Date("2026-11-03T14:00:00Z"), deliveredAt: new Date("2026-11-04T14:00:00Z"), deletedAt: new Date() }),
  ]);
  const cases = [
    { criterion: "scheduled" as const, date: "2026-11-01", records: [delivered, returned, ready] },
    { criterion: "arrived" as const, date: "2026-11-02", records: [delivered, returned, ready] },
    { criterion: "ready" as const, date: "2026-11-03", records: [delivered, ready] },
    { criterion: "delivered" as const, date: "2026-11-04", records: [delivered, returned] },
  ];
  for (const entry of cases) {
    const bounds = periodBounds("day", entry.date);
    const queue = await operationalQueue({ ...bounds, criterion: entry.criterion });
    const summary = await controlSummary(entry.date, "day", bounds, entry.criterion);
    assert.deepEqual(new Set(queue.items.map(item => String(item._id))), new Set(entry.records.map(item => String(item._id))), entry.criterion);
    assert.equal(queue.total, entry.records.length, entry.criterion);
    assert.equal(summary.total, queue.total, entry.criterion);
    assert.equal(summary.completed, queue.counts!.delivered || 0);
    assert.equal(summary.returned, queue.counts!.returned || 0);
    assert.equal(summary.periodReceivable, entry.records.includes(ready) ? 50 : 0);
    assert.equal(summary.onSite, 1, "Fila física não depende do filtro histórico");
  }
  const deliveredDay = await operationalQueue({ ...periodBounds("day", "2026-11-04"), criterion: "delivered" });
  assert.equal(deliveredDay.items[1].returnReason, "Cliente retirou o veículo sem serviço");
  assert.equal(+deliveredDay.items[1].returnedAt, +new Date("2026-11-04T15:00:00Z"));
  assert.equal((await operationalQueue()).items.some(item => item.status === "returned"), false);
  assert.equal((await operationalQueue({ ...periodBounds("day", "2026-11-04"), criterion: "ready" })).total, 0);
});

test("Entrega e devolução respeitam fronteiras de Fortaleza, sem usar a data agendada como fallback", async () => {
  const [before, first, last] = await Appointment.create([
    record("2026-11-04T14:00:00Z", "delivered", { deliveredAt: new Date("2026-11-04T02:59:59.999Z") }),
    record("2026-10-01T14:00:00Z", "returned", { returnedAt: new Date("2026-11-04T03:00:00Z"), returnReason: "Retirada antecipada pelo cliente" }),
    record("2026-10-01T14:00:00Z", "delivered", { deliveredAt: new Date("2026-11-05T02:59:59.999Z") }),
    record("2026-11-04T14:00:00Z", "returned", { returnedAt: new Date("2026-11-05T03:00:00Z"), returnReason: "Retirada posterior pelo cliente" }),
    record("2026-11-04T14:00:00Z", "confirmed"),
  ]);
  const queue = await operationalQueue({ ...periodBounds("day", "2026-11-04"), criterion: "delivered" });
  assert.deepEqual(queue.items.map(item => String(item._id)), [first, last].map(item => String(item._id)));
  const previous = await operationalQueue({ ...periodBounds("day", "2026-11-03"), criterion: "delivered" });
  assert.deepEqual(previous.items.map(item => String(item._id)), [String(before._id)]);
  await assert.rejects(operationalQueue({ ...periodBounds("day", "2026-11-04"), criterion: "invalid" as any }), /Critério de data inválido/);
});

test("Contagens pelo dia da entrada permanecem completas antes da paginação", async () => {
  await Appointment.insertMany(Array.from({ length: 205 }, (_, index) => record("2026-10-01T14:00:00Z", index % 2 ? "delivered" : "returned", {
    arrivedAt: new Date(+new Date("2026-11-04T14:00:00Z") + index * 60000),
    ...(index % 2 ? { deliveredAt: new Date("2026-11-05T14:00:00Z") } : { returnedAt: new Date("2026-11-05T14:00:00Z"), returnReason: "Retirada pelo cliente sem execução" }),
  })));
  const bounds = periodBounds("day", "2026-11-04");
  const pages = await Promise.all([1, 2, 3].map(page => operationalQueue({ ...bounds, criterion: "arrived", page })));
  assert.deepEqual(pages.map(page => page.items.length), [100, 100, 5]);
  for (const page of pages) {
    assert.equal(page.total, 205);
    assert.equal(page.counts!.returned, 103);
    assert.equal(page.counts!.delivered, 102);
  }
  const ids = pages.flatMap(page => page.items.map(item => String(item._id)));
  assert.equal(new Set(ids).size, 205);
  const summary = await controlSummary("2026-11-04", "day", bounds, "arrived");
  assert.equal(summary.total, 205);
  assert.equal(summary.returned, 103);
  assert.equal(summary.completed, 102);
});

test("Busca e status filtram antes de paginar e resumo usa os mesmos clientes em todos os critérios", async () => {
  const user = await User.create({ clerkId: "filtered-history-client", name: "Cliente Procurado [especial].*" });
  const common = { scheduledAt: "2026-11-04T14:00:00Z", arrivedAt: new Date("2026-11-05T14:00:00Z"), readyAt: new Date("2026-11-06T14:00:00Z"), deliveredAt: new Date("2026-11-07T14:00:00Z") };
  await Appointment.insertMany(Array.from({ length: 205 }, (_, index) => record(common.scheduledAt, "delivered", {
    ...common, userId: user._id, vehicle: { ...vehicle, plate: "SRC1A23" }, trackingToken: `private-token-${index}`, trackingTokenHash: `private-hash-${index}`, deletionReason: "internal-private-deletion",
  })));
  await Appointment.create([
    record(common.scheduledAt, "ready", { ...common, userId: user._id, deliveredAt: undefined }),
    record(common.scheduledAt, "delivered", { ...common, guestName: "Cliente diferente" }),
    record(common.scheduledAt, "delivered", { ...common, userId: user._id, deletedAt: new Date() }),
    record("2026-11-08T14:00:00Z", "delivered", { ...common, scheduledAt: new Date("2026-11-08T14:00:00Z"), arrivedAt: new Date("2026-11-09T14:00:00Z"), readyAt: new Date("2026-11-10T14:00:00Z"), deliveredAt: new Date("2026-11-11T14:00:00Z"), userId: user._id }),
  ]);
  const filters = { search: "  cliente procurado [especial].*  ", status: "delivered" as const };
  for (const entry of [{ criterion: "scheduled" as const, date: "2026-11-04" }, { criterion: "arrived" as const, date: "2026-11-05" },
    { criterion: "ready" as const, date: "2026-11-06" }, { criterion: "delivered" as const, date: "2026-11-07" }]) {
    const bounds = periodBounds("day", entry.date);
    const pages = await Promise.all([1, 2, 3].map(page => operationalQueue({ ...bounds, ...filters, criterion: entry.criterion, page })));
    assert.deepEqual(pages.map(page => page.items.length), [100, 100, 5]);
    for (const page of pages) { assert.equal(page.total, 205);assert.equal(page.counts!.delivered, 205);assert.equal(page.counts!.ready, undefined); }
    assert.equal(new Set(pages.flatMap(page => page.items.map(item => String(item._id)))).size, 205);
    const summary = await controlSummary(entry.date, "day", bounds, entry.criterion, filters);
    assert.equal(summary.total, 205);assert.equal(summary.completed, 205);assert.equal(summary.periodReceivable, 0);
    const serialized = JSON.stringify(pages);
    for (const secret of ["private-token", "private-hash", "internal-private-deletion", "trackingToken"])
      assert.equal(serialized.includes(secret), false, secret);
  }
});

test("Busca literal encontra nome avulso e placa com ou sem hífen sem transformar caracteres em expressão", async () => {
  const [normalized, legacy, literal] = await Appointment.create([
    record("2026-11-05T14:00:00Z", "confirmed", { vehicle: { ...vehicle, plate: "ABC1D23" }, guestName: "Ana" }),
    record("2026-11-05T14:00:00Z", "confirmed", { vehicle: { ...vehicle, plate: "ABC-1D23" }, guestName: "Bia" }),
    record("2026-11-05T14:00:00Z", "returned", { guestName: "Joel [fila].*", returnedAt: new Date("2026-11-05T15:00:00Z") }),
  ]);
  const bounds = periodBounds("day", "2026-11-05");
  for (const search of ["abc1d23", "  ABC-1D23  ", "ABC 1D23"])
    assert.deepEqual(new Set((await operationalQueue({ ...bounds, search })).items.map(item => String(item._id))), new Set([normalized, legacy].map(item => String(item._id))));
  const found = await operationalQueue({ ...bounds, search: "[fila].*" });
  assert.deepEqual(found.items.map(item => String(item._id)), [String(literal._id)]);
  assert.equal((await operationalQueue({ ...bounds, search: "(.*|^)" })).total, 0);
  assert.equal((await controlSummary("2026-11-05", "day", bounds, "delivered", { search: "[fila].*", status: "returned" })).total, 1);
  await assert.rejects(operationalQueue({ ...bounds, search: "x".repeat(101) }));
  await assert.rejects(controlSummary("2026-11-05", "day", bounds, "scheduled", { search: "x".repeat(101) }));
  await assert.rejects(operationalQueue(undefined, { status: "forged" as any }));
});

test("Busca na fila física preserva posição original de recebidos e não limita resultados a cem", async () => {
  const user = await User.create({ clerkId: "physical-search-client", name: "Cliente da fila original" });
  const [first, second, third] = await Appointment.create([
    record("2026-11-05T14:00:00Z", "arrived", { guestName: "Primeiro", arrivedAt: new Date("2026-11-05T12:00:00Z") }),
    record("2026-11-04T14:00:00Z", "arrived", { userId: user._id, vehicle: { ...vehicle, plate: "MID1A23" }, arrivedAt: new Date("2026-11-05T13:00:00Z") }),
    record("2026-11-05T14:00:00Z", "arrived", { guestName: "Terceiro", arrivedAt: new Date("2026-11-05T14:00:00Z") }),
    record("2026-11-03T14:00:00Z", "ready", { guestName: "Pronto", arrivedAt: new Date("2026-11-03T14:00:00Z") }),
    record("2026-11-05T14:00:00Z", "arrived", { userId: user._id, arrivedAt: new Date("2026-11-05T11:00:00Z"), deletedAt: new Date() }),
    record("2026-11-05T14:00:00Z", "returned", { userId: user._id, arrivedAt: new Date("2026-11-05T11:00:00Z"), returnedAt: new Date("2026-11-05T15:00:00Z") }),
  ]);
  const original = await operationalQueue();
  assert.deepEqual(original.items.filter(item => item.status === "arrived").map(item => [String(item._id), item.queuePosition]),
    [first, second, third].map((item, index) => [String(item._id), index + 1]));
  const filtered = await operationalQueue(undefined, { search: "cliente da fila original", status: "arrived" });
  assert.equal(filtered.total, 1);assert.equal(String(filtered.items[0]._id), String(second._id));assert.equal(filtered.items[0].queuePosition, 2);
  assert.equal((await operationalQueue(undefined, { search: "MID-1A23" })).items[0].queuePosition, 2);
  const summary = await controlSummary("2026-11-05", "day", undefined, "scheduled", { search: "cliente da fila original", status: "arrived" });
  assert.equal(summary.onSite, 1);assert.equal(summary.waiting, 1);assert.equal(summary.physicalReceivable, 50);assert.equal(summary.total, 0);
  await Appointment.insertMany(Array.from({ length: 125 }, (_, index) => record("2026-10-01T14:00:00Z", "arrived", {
    guestName: "Grupo numeroso na fila", arrivedAt: new Date(+new Date("2026-11-06T14:00:00Z") + index * 60000),
  })));
  const numerous = await operationalQueue(undefined, { search: "grupo numeroso na fila" });
  assert.equal(numerous.total, 125);assert.equal(numerous.items.length, 125);
  assert.equal(numerous.items[0].queuePosition, 4);assert.equal(numerous.items.at(-1)!.queuePosition, 128);
});
