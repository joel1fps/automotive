import { after, before, test } from "node:test";
import Module from "node:module";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import { Appointment, Audit, Coupon, RateLimit, Service, Transaction, User, connectDB } from "../../src/lib/db";
import { generateTracking } from "../../src/lib/tracking";
import { getSettings, seedCatalog } from "../../src/lib/business";
import { localDate, localSlots } from "../../src/lib/domain";

let server: MongoMemoryReplSet;
let handlers: typeof import("../../src/app/api/[...path]/route");
let identity: ReturnType<typeof clientIdentity> | null = null;
let currentUserReads = 0;
function clientIdentity(id = "api-profile-client", verified = true) {
  return {
    id, firstName: "Cliente", lastName: "API", publicMetadata: {},
    // Client-editable metadata must never grant privileges.
    unsafeMetadata: { role: "admin" },
    primaryEmailAddressId: "fixture-email",
    emailAddresses: [{ id: "fixture-email", emailAddress: "client-api@example.com", verification: { status: verified ? "verified" : "unverified" } }],
  };
}

before(async () => {
  const serverExports = {
    auth: async () => ({ userId: identity?.id || null }),
    currentUser: async () => { currentUserReads += 1; return identity; },
    clerkClient: async () => { throw new Error("Clerk externo não deve ser chamado neste teste."); },
  };
  const webhookExports = {
    verifyWebhook: async () => { throw new Error("Webhook não faz parte deste teste."); },
  };
  // Isolate the external provider in this child process. Route handlers,
  // requireActor, serverRole and Mongo writes run their production implementations.
  for (const [specifier, exports] of [["@clerk/nextjs/server", serverExports], ["@clerk/nextjs/webhooks", webhookExports]] as const) {
    const commonJsPath = require.resolve(specifier);
    const provider = new Module(commonJsPath);
    provider.filename = commonJsPath;
    provider.loaded = true;
    provider.exports = exports;
    require.cache[commonJsPath] = provider;
  }
  assert.deepEqual(await require("@clerk/nextjs/server").auth(), { userId: null });
  process.env.CLERK_SECRET_KEY = "fixture-clerk-secret-key";
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "fixture-clerk-public-key";
  process.env.ADMIN_EMAILS = "admin-api@example.com";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.ALLOWED_ORIGINS = "";
  delete process.env.VERCEL;
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.13" } });
  process.env.MONGODB_URI = server.getUri();
  await connectDB();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  handlers = await import("../../src/app/api/[...path]/route");
  const { requireActor } = await import("../../src/lib/auth");
  await assert.rejects(requireActor(), (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 401);
}, { timeout: 60000 });
after(async () => { await mongoose.disconnect(); await server?.stop(); });

async function request(route: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", input?: unknown, extraHeaders: Record<string, string | undefined> = {}) {
  const headers = new Headers(method !== "GET" ? { "Content-Type": "application/json", Origin: "http://localhost:3000" } : {});
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  const req = new NextRequest(`http://localhost:3000/api/${route}`, {
    method,
    headers,
    ...(method !== "GET" ? { body: JSON.stringify(input || {}) } : {}),
  });
  return await handlers[method](req, { params: Promise.resolve({ path: route.split("?")[0].split("/") }) });
}

const id = "0123456789abcdef01234567";
const administrativeRoutes: [string, "GET" | "POST" | "PATCH" | "DELETE"][] = [
  ["admin/appointments", "GET"], ["admin/appointments", "POST"], [`admin/appointments/${id}`, "PATCH"],
  [`admin/appointments/${id}`, "DELETE"], ["admin/audit", "GET"],
  ["admin/appointments/calendar?date=2040-10-05&range=month", "GET"],
  [`admin/appointments/${id}/notify`, "POST"], ["admin/queue", "GET"], ["admin/control", "GET"],
  ["admin/queue?search=ABC-1D23&status=arrived", "GET"], ["admin/control?search=Cliente&status=ready", "GET"],
  ["admin/clients", "GET"], [`admin/clients/${id}`, "PATCH"], [`admin/clients/${id}/role`, "PATCH"],
  [`admin/clients/${id}/points`, "PATCH"], ["admin/services", "GET"], ["admin/services", "POST"],
  [`admin/services/${id}`, "PATCH"], [`admin/services/${id}`, "DELETE"], [`admin/services/${id}/reset`, "POST"],
  ["admin/catalog-reset", "POST"], ["admin/coupons", "GET"], ["admin/coupons", "POST"],
  ["admin/settings", "GET"], ["admin/settings", "PATCH"], ["admin/slots", "GET"], ["admin/slots", "PATCH"],
  ["admin/transactions", "GET"], ["admin/transactions", "POST"], ["admin/finance", "GET"], ["admin/finance/export", "GET"],
  [`admin/transactions/${id}/correction`, "POST"], ["admin/service-report?date=2040-10-05&range=month&criterion=ready", "GET"],
  ["admin/finance/export?format=xml", "GET"],
  [`admin/appointments/${id}/tracking`, "GET"], [`admin/appointments/${id}/tracking`, "POST"],
  [`admin/appointments/${id}/tracking`, "PATCH"], [`admin/appointments/${id}/tracking`, "DELETE"],
];

test("API real: visitante recebe 401 em todas as famílias administrativas e no perfil", async () => {
  identity = null;
  for (const [route, method] of administrativeRoutes) {
    const response = await request(route, method);
    assert.equal(response.status, 401, `${method} ${route}`);
    assert.match((await response.json()).error, /Entre na sua conta/);
  }
  assert.equal((await request("profile/me")).status, 401);
  assert.equal((await request("profile/me", "PATCH", { name: "Cliente API", phone: "85999123456" })).status, 401);
  assert.equal((await request("admin/queue", "GET", undefined, {
    "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy", "x-user-role": "admin",
  })).status, 401);
});

test("API real: cliente autenticado recebe 403 mesmo com unsafeMetadata.role admin", async () => {
  identity = clientIdentity("api-denied-client");
  for (const [route, method] of administrativeRoutes) {
    const response = await request(route, method);
    assert.equal(response.status, 403, `${method} ${route}`);
    assert.match((await response.json()).error, /Acesso restrito/);
  }
  assert.equal(await User.countDocuments({ clerkId: identity.id }), 0);
});

test("API real: e-mail administrativo não verificado continua recebendo 403", async () => {
  identity = clientIdentity("api-unverified", false);
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  assert.equal((await request("admin/queue")).status, 403);
  assert.equal((await request(`admin/appointments/${id}`, "PATCH", { action: "complete", finalPrice: 50, paymentMethod: "pix" })).status, 403);
});

test("API real: perfil salva nome e telefone normalizados sem alterar outros clientes", async () => {
  identity = clientIdentity("api-profile-save");
  const initialResponse = await request("profile/me");
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.complete, false);
  const other = await User.create({ clerkId: "api-other-client", name: "Outra Pessoa", phone: "5585999129876", role: "client", loyaltyCount: 6 });
  const response = await request("profile/me", "PATCH", { name: "  João  da Silva ", phone: "(85) 99912-3456" });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.name, "João da Silva");
  assert.equal(updated.phone, "5585999123456");
  assert.equal(updated.role, "client");
  assert.equal(updated.complete, true);
  assert.equal(updated._id, initial._id);
  assert.equal((await User.findById(other._id)).name, "Outra Pessoa");
  assert.equal((await User.findById(other._id)).loyaltyCount, 6);
  // Reauthentication must not overwrite the edited local name.
  assert.equal((await (await request("profile/me")).json()).name, "João da Silva");
});

test("API real: perfil rejeita escalada, identidade, IDs e telefone inválido com erro 400", async () => {
  identity = clientIdentity("api-profile-injection");
  assert.equal((await request("profile/me", "PATCH", { name: "João da Silva", phone: "85999123456" })).status, 200);
  const existing = await User.findOne({ clerkId: identity.id });
  for (const extra of [{ role: "admin" }, { loyaltyCount: 9 }, { userId: id }, { _id: id }, { clerkId: "api-other-client" }, { email: "admin-api@example.com" }]) {
    const response = await request("profile/me", "PATCH", { name: "João da Silva", phone: "85999123456", ...extra });
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.ok((await response.json()).error);
  }
  assert.equal((await request("profile/me", "PATCH", { name: "João da Silva", phone: "12345" })).status, 400);
  const user = await User.findById(existing._id);
  assert.equal(user.role, "client");
  assert.equal(user.loyaltyCount, 0);
  assert.equal(user.email, "client-api@example.com");
  assert.equal(user.phone, "5585999123456");
  assert.equal((await request("admin/queue")).status, 403);
});

test("API real: papel local adulterado, headers e payload do navegador não concedem administração", async () => {
  identity = clientIdentity("api-local-role-forgery");
  const own = await User.create({ clerkId: identity.id, name: "Cliente Teste", role: "admin" });
  const forgedHeaders = {
    "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
    "x-user-role": "admin", "x-clerk-user-id": "fixture-admin",
  };
  assert.equal((await request("admin/queue", "GET", undefined, forgedHeaders)).status, 403);
  assert.equal((await request(`admin/clients/${own._id}/role`, "PATCH", { role: "admin" }, forgedHeaders)).status, 403);
  assert.equal((await request("admin/appointments", "POST", { role: "admin", userId: String(own._id), walkIn: true }, forgedHeaders)).status, 403);
  // Normal authentication overwrites a stale or adulterated Mongo role from trusted Clerk data.
  assert.equal((await (await request("profile/me")).json()).role, "client");
  assert.equal((await User.findById(own._id)).role, "client");
  assert.equal(await Appointment.countDocuments({ userId: own._id }), 0);
});

test("API real: revogar privilégio no Clerk bloqueia a chamada seguinte mesmo com papel antigo no Mongo", async () => {
  identity = clientIdentity("api-revoked-admin");
  identity.publicMetadata = { role: "admin" };
  assert.equal((await request("admin/queue")).status, 200);
  const local = await User.findOne({ clerkId: identity.id });
  assert.equal(local.role, "admin");
  identity.publicMetadata = {};
  assert.equal((await request("admin/queue")).status, 403);
  assert.equal((await request(`admin/clients/${local._id}/role`, "PATCH", { role: "admin" })).status, 403);
  assert.equal((await (await request("profile/me")).json()).role, "client");
  assert.equal((await User.findById(local._id)).role, "client");
});

test("API real: operadores Mongo e objetos no lugar de campos não chegam às consultas", async () => {
  identity = clientIdentity("api-nosql-injection");
  const validProfile = { name: "Cliente Seguro", phone: "85999123456" };
  assert.equal((await request("profile/me", "PATCH", validProfile)).status, 200);
  for (const payload of [
    { ...validProfile, name: { $ne: null } },
    { ...validProfile, phone: { $regex: ".*" } },
    { ...validProfile, $set: { role: "admin" } },
    { ...validProfile, $where: "return true" },
    JSON.parse('{"name":"Cliente Seguro","phone":"85999123456","__proto__":{"role":"admin"}}'),
  ]) assert.equal((await request("profile/me", "PATCH", payload)).status, 400);
  const vehicle = { model: "Onix", plate: "NSQ1A23", type: "small" };
  const validBooking = { serviceId: id, vehicle, consent: true, scheduledAt: new Date(Date.now() + 86400000).toISOString() };
  for (const payload of [
    { ...validBooking, serviceId: { $ne: null } },
    { ...validBooking, couponId: { $ne: null } },
    { ...validBooking, vehicle: { ...vehicle, model: { $where: "return true" } } },
  ]) assert.equal((await request("appointments", "POST", payload)).status, 400);
  const own = await User.findOne({ clerkId: identity.id });
  assert.equal(own.name, validProfile.name);
  assert.equal(own.phone, "5585999123456");
  assert.equal(own.role, "client");
  assert.equal(await Appointment.countDocuments({ userId: own._id }), 0);
  assert.equal(({} as Record<string, unknown>).role, undefined);
});

test("API real: mutações de origem maliciosa, entre sites ou sem evidência de origem são bloqueadas", async () => {
  identity = clientIdentity("api-csrf-client");
  const validProfile = { name: "Cliente Protegido", phone: "85999123456" };
  assert.equal((await request("profile/me", "PATCH", validProfile)).status, 200);
  const initial = await User.findOne({ clerkId: identity.id }).lean();
  const readsBefore = currentUserReads;
  for (const headers of [
    { Origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    { Origin: "https://evil.example" },
    { Origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
    { Origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
    { Origin: undefined },
  ]) {
    const response = await request("profile/me", "PATCH", { name: "Nome Atacante", phone: "85999129876" }, headers);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Origem não permitida/);
  }
  assert.equal(currentUserReads, readsBefore);
  const after = await User.findById(initial._id).lean();
  assert.equal(after.name, initial.name);
  assert.equal(after.phone, initial.phone);
  assert.equal(after.role, "client");
});

test("API real: limite bloqueia antes da consulta Clerk e tentativas administrativas negadas também contam", async () => {
  identity = clientIdentity("api-rate-limited-client");
  const minute = Math.floor(Date.now() / 60000);
  // Include the next minute so a wall-clock boundary cannot make this regression flaky.
  await RateLimit.create([minute, minute + 1].flatMap(window => [
    { key: `actor:${identity!.id}:read:${window}`, count: 120, expiresAt: new Date(Date.now() + 180000) },
    { key: `actor:${identity!.id}:write:${window}`, count: 30, expiresAt: new Date(Date.now() + 180000) },
  ]));
  const readsBefore = currentUserReads;
  assert.equal((await request("profile/me")).status, 429);
  assert.equal((await request("profile/me", "PATCH", { name: "Cliente Limitado", phone: "85999123456" })).status, 429);
  assert.equal(currentUserReads, readsBefore);
  assert.equal(await User.countDocuments({ clerkId: identity.id }), 0);

  identity = clientIdentity("api-denial-counted-client");
  assert.equal((await request("admin/queue")).status, 403);
  assert.equal((await request(`admin/clients/${id}/role`, "PATCH", { role: "admin" })).status, 403);
  assert.equal(currentUserReads, readsBefore + 2);
  const records = await RateLimit.find({ key: { $regex: `^actor:${identity.id}:` } }).lean();
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.key.includes(":read:")).count, 1);
  assert.equal(records.find(record => record.key.includes(":write:")).count, 1);
  assert.equal(await User.countDocuments({ clerkId: identity.id }), 0);
});

test("API real: cliente só lê seus atendimentos e cupons e não reserva cupom de outra pessoa", async () => {
  identity = clientIdentity("api-ownership-client");
  assert.equal((await request("profile/me", "PATCH", { name: "Cliente Proprietário", phone: "85999123456" })).status, 200);
  const own = await User.findOne({ clerkId: identity.id });
  const other = await User.create({ clerkId: "api-ownership-other", name: "Outra Pessoa", phone: "5585999129876", role: "client" });
  const vehicle = { model: "Onix", plate: "OWN1A23", type: "small" };
  const [ownAppointment, otherAppointment] = await Appointment.create([
    { userId: own._id, vehicle, serviceName: "Lavagem", scheduledAt: new Date(), status: "delivered" },
    { userId: other._id, vehicle: { ...vehicle, plate: "OTH1A23" }, serviceName: "Lavagem", scheduledAt: new Date(), status: "confirmed" },
  ]);
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  const [ownCoupon, otherCoupon] = await Coupon.create([
    { userId: own._id, vehiclePlate: vehicle.plate, vehicleType: vehicle.type, issuedAt: new Date(), expiresAt, issueKey: "api-ownership-own" },
    { userId: other._id, vehiclePlate: vehicle.plate, vehicleType: vehicle.type, issuedAt: new Date(), expiresAt, issueKey: "api-ownership-other" },
  ]);
  const appointments = await (await request(`appointments/me?userId=${other._id}`)).json();
  assert.deepEqual(appointments.items.map((item: { _id: string }) => item._id), [String(ownAppointment._id)]);
  const loyalty = await (await request(`loyalty/me?userId=${other._id}`)).json();
  assert.deepEqual(loyalty.coupons.map((item: { _id: string }) => item._id), [String(ownCoupon._id)]);
  assert.equal((await request(`admin/appointments/${otherAppointment._id}`, "PATCH", { action: "cancel" })).status, 403);
  assert.equal((await request(`appointments/${otherAppointment._id}`)).status, 404);

  await seedCatalog();
  const settings = await getSettings();
  const service = await Service.findOne({ slug: "simples" });
  let day = new Date(Date.now() + 4 * 86400000);
  while (!localSlots(localDate(day), settings).length) day = new Date(+day + 86400000);
  const scheduledAt = localSlots(localDate(day), settings)[0].toISOString();
  const booking = { serviceId: String(service._id), vehicle, consent: true, scheduledAt };
  assert.equal((await request("appointments", "POST", { ...booking, couponId: String(otherCoupon._id) })).status, 409);
  assert.equal((await Coupon.findById(otherCoupon._id)).reservedAppointmentId, undefined);
  assert.equal(await Appointment.countDocuments({ userId: own._id }), 1);
  assert.equal(await Appointment.countDocuments({ userId: other._id }), 1);
  // Unknown ownership/price/state fields are either rejected or stripped; neither may override the server.
  const forgedBooking = await request("appointments", "POST", {
    ...booking, userId: String(other._id), role: "admin", status: "confirmed", quotedPrice: 0, finalPrice: 0,
  });
  assert.ok([201, 400].includes(forgedBooking.status));
  const response = forgedBooking.status === 201 ? forgedBooking : await request("appointments", "POST", booking);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.userId, String(own._id));
  assert.equal(created.status, "pending");
  assert.equal(created.quotedPrice, service.prices.small);
  assert.equal(created.finalPrice, undefined);
  assert.equal(await Appointment.countDocuments({ userId: other._id }), 1);
  assert.equal((await Appointment.findById(otherAppointment._id)).status, "confirmed");
});

test("API real: link válido é público, somente leitura e sem dados administrativos", async () => {
  identity = null;
  const appointment = await Appointment.create({ guestName: "Pessoa Privada", guestPhone: "5585999123456",
    vehicle: { model: "Onix público", plate: "API1A23", type: "small" }, serviceName: "Lavagem teste",
    scheduledAt: new Date(), status: "confirmed", notes: "Nota interna", finalPrice: 123, paymentMethod: "pix" });
  const generated = await generateTracking(String(appointment._id), "generate", "fixture-admin");
  const token = generated.url!.split("/").at(-1)!;
  const response = await request(`tracking/${token}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(response.headers.get("X-Robots-Tag") || "", /noindex/);
  const dto = await response.json();
  assert.equal(dto.vehicle.plate, "API1A23");
  for (const privateField of ["_id", "userId", "guestName", "guestPhone", "notes", "finalPrice", "paymentMethod", "trackingToken", "trackingTokenHash"])
    assert.equal(privateField in dto, false, privateField);
  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    const write = await request(`tracking/${token}`, method, { action: "start" });
    assert.equal(write.status, 405);
    assert.equal(write.headers.get("Allow"), "GET");
  }
  assert.equal((await Appointment.findById(appointment._id)).status, "confirmed");
  assert.equal((await request("tracking/invalido")).status, 404);
});

test("API real: administrador gera, copia, renova, define previsão e revoga acompanhamento", async () => {
  identity = clientIdentity("api-tracking-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const appointment = await Appointment.create({ guestName: "Avulso de teste", vehicle: { model: "Onix", plate: "API2A23", type: "small" },
    serviceName: "Lavagem", scheduledAt: new Date(), status: "arrived", arrivedAt: new Date() });
  const route = `admin/appointments/${appointment._id}/tracking`;
  const generate = await request(route, "POST", { action: "generate" });
  assert.equal(generate.status, 200);
  const initial = await generate.json();
  const initialToken = initial.url.split("/").at(-1);
  assert.equal((await (await request(route)).json()).url, initial.url);
  const estimate = new Date(Date.now() + 3600000).toISOString();
  assert.equal((await request(route, "PATCH", { estimatedCompletionAt: estimate })).status, 200);
  assert.equal((await (await request(`tracking/${initialToken}`)).json()).estimatedCompletionAt, estimate);
  assert.equal((await request(route, "PATCH", { estimatedCompletionAt: estimate, role: "admin" })).status, 400);
  const renew = await request(route, "POST", { action: "regenerate" });
  assert.equal(renew.status, 200);
  const rotated = await renew.json();
  assert.notEqual(rotated.url, initial.url);
  assert.equal((await request(`tracking/${initialToken}`)).status, 404);
  const revoked = await request(route, "DELETE");
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).url, null);
  assert.equal((await request(`tracking/${rotated.url.split("/").at(-1)}`)).status, 404);
  const ordinary = await Appointment.findById(appointment._id).lean();
  assert.equal("trackingToken" in ordinary, false);
  assert.equal("trackingTokenHash" in ordinary, false);
});

test("API real: exportação Excel autorizada respeita dia, semana, mês e período personalizado em Fortaleza", async () => {
  identity = clientIdentity("api-excel-export-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const category = "excel_api_fixture";
  const appointment = await Appointment.create({
    guestName: "Nome atual do atendimento",
    guestPhone: "5585999123456",
    vehicle: { model: "Modelo atual", plate: "NEW1A23", type: "small" },
    serviceName: "Serviço atual",
    scheduledAt: new Date("2026-09-30T23:00:00Z"),
    arrivedAt: new Date("2026-09-30T23:00:00Z"),
    startedAt: new Date("2026-09-30T23:05:00Z"),
    readyAt: new Date("2026-10-01T02:50:00Z"),
    completedAt: new Date("2026-10-01T03:00:00Z"),
    deliveredAt: new Date("2026-10-01T03:10:00Z"),
    status: "delivered",
    notes: "Nota administrativa confidencial Excel",
  });
  const dates = [
    "2026-09-28T02:59:59.999Z", // Before Monday in Fortaleza.
    "2026-09-28T03:00:00.000Z", // Monday, start of the selected week.
    "2026-10-01T03:00:00.000Z", // Thursday, start of the selected day/month.
    "2026-10-02T02:59:59.999Z", // Thursday, last instant of the selected day.
    "2026-10-02T03:00:00.000Z", // Friday, excluded from the daily interval.
    "2026-10-05T02:59:59.999Z", // Sunday, last instant of the selected week.
    "2026-10-05T03:00:00.000Z", // Next Monday, excluded from the week.
    "2026-11-01T02:59:59.999Z", // Last instant of October in Fortaleza.
    "2026-11-01T03:00:00.000Z", // November, excluded from the month.
  ];
  const entries = await Transaction.create(dates.map((date, index) => ({
    date: new Date(date), description: `Limite Excel ${index}`, category,
    source: index === 2 ? "appointment" : "manual",
    amount: index === 2 ? 17.45 : index + 1,
    paymentMethod: "pix",
    ...(index === 2 ? {
      appointmentId: appointment._id,
      clientName: "Cliente Excel da integração",
      serviceName: "Lavagem Excel de integração",
      vehicleModel: "Onix Excel da integração",
      vehiclePlate: "XLS1A23",
      createdBy: "Identidade administrativa interna Excel",
      notes: "Nota financeira confidencial Excel",
    } : {}),
  })));
  const wrongFilters = await Transaction.create([
    { date: new Date(dates[2]), description: "Outra categoria Excel", category: "other_excel_api_fixture", source: "manual", amount: 99, paymentMethod: "pix" },
    { date: new Date(dates[2]), description: "Outro pagamento Excel", category, source: "manual", amount: 99, paymentMethod: "card" },
  ]);

  const cases = [
    { query: "range=day&date=2026-10-01", expected: [2, 3], filename: "2026-10-01-a-2026-10-01" },
    { query: "range=week&date=2026-10-01", expected: [1, 2, 3, 4, 5], filename: "2026-09-28-a-2026-10-04" },
    { query: "range=month&date=2026-10-01", expected: [2, 3, 4, 5, 6, 7], filename: "2026-10-01-a-2026-10-31" },
    { query: "from=2026-10-01&to=2026-10-01", expected: [2, 3], filename: "2026-10-01-a-2026-10-01" },
  ];
  for (const { query, expected, filename } of cases) {
    const response = await request(`admin/finance/export?format=xlsx&report=receipts&${query}&category=${category}&paymentMethod=pix`);
    assert.equal(response.status, 200, query);
    assert.equal(response.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(response.headers.get("Content-Disposition"), `attachment; filename="automotive-faturamento-${filename}.xlsx"`);
    assert.match(response.headers.get("Cache-Control") || "", /no-store/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(await response.arrayBuffer()) as never);
    const values = JSON.stringify(book.getWorksheet("Entradas")!.getSheetValues());
    for (const [index, entry] of entries.entries()) {
      assert.equal(values.includes(entry.serviceName || entry.description), expected.includes(index), `${query}: lançamento ${index}`);
    }
    for (const entry of wrongFilters) assert.equal(values.includes(entry.description), false);
    for (const visibleValue of ["Cliente Excel da integração", "Lavagem Excel de integração", "Onix Excel da integração", "XLS1A23", "17.45"])
      assert.ok(values.includes(visibleValue), `${query}: ${visibleValue}`);
    for (const privateValue of [appointment.guestPhone, appointment.notes, entries[2].createdBy, entries[2].notes])
      assert.equal(values.includes(privateValue), false, privateValue);
  }
  // Omitting the format must preserve the original Excel export for existing callers.
  const excelResponse = await request(`admin/finance/export?range=day&date=2026-10-01&category=${category}&paymentMethod=pix`);
  assert.equal(excelResponse.status, 200);
  assert.equal(excelResponse.headers.get("Content-Type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(excelResponse.headers.get("Content-Disposition"), 'attachment; filename="automotive-faturamento-2026-10-01-a-2026-10-01.xlsx"');
  assert.match(excelResponse.headers.get("Cache-Control") || "", /no-store/);
  const excelBytes = new Uint8Array(await excelResponse.arrayBuffer());
  assert.deepEqual([...excelBytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const unpaid = await Appointment.create({ guestName: "Cliente sem pagamento", vehicle: { model: "Celta completo", plate: "ALL1A23", type: "small" },
    serviceName: "Serviço futuro do completo", serviceCategory: category, quotedPrice: 70, status: "pending",
    scheduledAt: new Date("2026-10-01T14:00:00Z"), notes: "NOTA-PRIVADA-COMPLETO" });
  await RateLimit.deleteMany({}); // This process owns the temporary test database.
  const fullResponse = await request(`admin/finance/export?report=complete&format=xlsx&range=day&date=2026-10-01&category=${category}&paymentMethod=pix`);
  assert.equal(fullResponse.status, 200);
  assert.equal(fullResponse.headers.get("Content-Disposition"), 'attachment; filename="automotive-completo-2026-10-01-a-2026-10-01.xlsx"');
  const fullBook = new ExcelJS.Workbook();
  await fullBook.xlsx.load(new Uint8Array(await fullResponse.arrayBuffer()) as never);
  assert.deepEqual(fullBook.worksheets.map(sheet => sheet.name), ["Resumo", "Entradas", "Por serviço", "Resumo de veículos", "Veículos e serviços"]);
  const carValues = JSON.stringify(fullBook.getWorksheet("Veículos e serviços")!.getSheetValues());
  for (const value of [String(unpaid._id), unpaid.guestName, unpaid.vehicle.plate, unpaid.serviceName]) assert.ok(carValues.includes(value), value);
  assert.equal(carValues.includes(unpaid.notes), false);
  assert.equal((await request('admin/finance/export?report=complete&criterion=paid&format=xlsx')).status, 400);
});

test("API real: formato desconhecido não retorna exportação nem permite conteúdo arbitrário", async () => {
  identity = clientIdentity("api-xml-invalid-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  for (const format of ["xml", "csv", "text/html", "<script>"]) {
    const response = await request(`admin/finance/export?format=${encodeURIComponent(format)}&range=day&date=2026-10-01`);
    assert.equal(response.status, 400, format);
    assert.match(response.headers.get("Content-Type") || "", /^application\/json/);
    assert.equal(response.headers.get("Content-Disposition"), null);
    assert.ok((await response.json()).error);
  }
});

test("API real: exclusão exige motivo, autenticação administrativa e origem permitida sem confiar no payload", async () => {
  identity = clientIdentity("api-delete-validation-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const appointment = await Appointment.create({
    guestName: "Cliente da validação de exclusão",
    vehicle: { model: "Onix de validação", plate: "DEL1A23", type: "small" },
    serviceName: "Lavagem de validação", scheduledAt: new Date(), status: "pending",
  });
  const route = `admin/appointments/${appointment._id}`;
  for (const input of [
    {}, { reason: "    " }, { reason: "abc" }, { reason: "x".repeat(501) },
    { reason: { $ne: null } }, { reason: "Motivo válido", adminClerkId: "attacker-admin" },
    { reason: "Motivo válido", deletedAt: "2020-01-01T00:00:00.000Z" },
    { reason: "Motivo válido", role: "admin" },
  ]) {
    assert.equal((await request(route, "DELETE", input)).status, 400, JSON.stringify(input));
  }
  for (const headers of [
    { Origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    { Origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
    { Origin: undefined },
  ]) assert.equal((await request(route, "DELETE", { reason: "Tentativa sem origem válida" }, headers)).status, 403);
  assert.equal((await Appointment.findById(appointment._id)).deletedAt, undefined);
  assert.equal(await Audit.countDocuments({ appointmentId: appointment._id, action: "appointment_deleted" }), 0);
  assert.equal((await request(`admin/appointments/${id}`, "DELETE", { reason: "ID inexistente no sistema" })).status, 404);
  assert.equal((await request("admin/appointments/invalido", "DELETE", { reason: "ID inválido no sistema" })).status, 400);
});

test("API real: exclusão oculta atendimento, revoga acompanhamento e registra uma única auditoria do servidor", async () => {
  identity = clientIdentity("api-delete-owner");
  assert.equal((await request("profile/me", "PATCH", { name: "Cliente da exclusão", phone: "85999123456" })).status, 200);
  const owner = await User.findOne({ clerkId: identity.id });
  await User.updateOne({ _id: owner._id }, { $set: { loyaltyCount: 3, totalWashes: 7 } });
  const appointment = await Appointment.create({
    userId: owner._id,
    guestName: "Nome avulso confidencial", guestPhone: "5585999123456",
    vehicle: { model: "Onix da exclusão", plate: "DEL2A23", type: "small" },
    serviceName: "Lavagem da exclusão", scheduledAt: new Date(), status: "delivered",
    arrivedAt: new Date(Date.now() - 3600000), readyAt: new Date(Date.now() - 1800000),
    completedAt: new Date(Date.now() - 1200000), deliveredAt: new Date(Date.now() - 600000),
    finalPrice: 85.25, paymentMethod: "pix", notes: "Nota privada da exclusão", createdBy: "private-original-admin",
  });
  const receipt = await Transaction.create({
    date: new Date(), description: "Lavagem da exclusão", category: "wash", source: "appointment", appointmentId: appointment._id,
    userId: owner._id, clientName: owner.name, vehiclePlate: "DEL2A23", vehicleModel: "Onix da exclusão", serviceName: "Lavagem da exclusão",
    amount: 85.25, paymentMethod: "pix", createdBy: "private-finance-admin", notes: "Nota financeira privada da exclusão",
  });
  const generated = await generateTracking(String(appointment._id), "generate", "api-delete-admin");
  const token = generated.url!.split("/").at(-1)!;
  assert.equal((await request(`tracking/${token}`)).status, 200);
  identity = clientIdentity("api-delete-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const route = `admin/appointments/${appointment._id}`;
  const beforeDeletion = Date.now();
  const response = await request(route, "DELETE", { reason: "  Registro duplicado confirmado pelo administrador  " });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.id, String(appointment._id));
  assert.equal(result.deleted, true);
  assert.equal(result.alreadyDeleted, false);
  assert.ok(+new Date(result.deletedAt) >= beforeDeletion);
  const deleted = await Appointment.findById(appointment._id).select("+deletionReason +trackingToken +trackingTokenHash").lean();
  assert.equal(deleted.deletedBy, "api-delete-admin");
  assert.equal(deleted.deletionReason, "Registro duplicado confirmado pelo administrador");
  assert.equal(+deleted.deletedAt, +new Date(result.deletedAt));
  assert.equal(deleted.trackingToken, undefined);
  assert.equal(deleted.trackingTokenHash, undefined);
  const audit = await Audit.findOne({ appointmentId: appointment._id, action: "appointment_deleted" }).lean();
  assert.ok(audit);
  assert.equal(audit.adminClerkId, "api-delete-admin");
  assert.equal(audit.reason, deleted.deletionReason);
  assert.equal(audit.fromStatus, "delivered");
  assert.equal(audit.details.serviceName, appointment.serviceName);
  assert.equal(audit.details.vehicle.plate, appointment.vehicle.plate);
  const originalAuditId = String(audit._id);
  const originalTimestamp = +deleted.deletedAt;
  const repeated = await request(route, "DELETE", { reason: "Repetição acidental da solicitação" });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).alreadyDeleted, true);
  assert.equal(await Audit.countDocuments({ appointmentId: appointment._id, action: "appointment_deleted" }), 1);
  assert.equal(String((await Audit.findOne({ appointmentId: appointment._id, action: "appointment_deleted" }))._id), originalAuditId);
  assert.equal(+(await Appointment.findById(appointment._id)).deletedAt, originalTimestamp);
  assert.equal((await Transaction.findById(receipt._id)).amount, 85.25);
  assert.equal(await Transaction.countDocuments({ appointmentId: appointment._id }), 1);
  const unchangedOwner = await User.findById(owner._id);
  assert.equal(unchangedOwner.loyaltyCount, 3);
  assert.equal(unchangedOwner.totalWashes, 7);

  for (const endpoint of ["admin/appointments", "admin/appointments?status=delivered"]) {
    const list = await (await request(endpoint)).json();
    assert.equal(list.items.some((item: { _id: string }) => item._id === String(appointment._id)), false, endpoint);
  }
  assert.equal((await request(`tracking/${token}`)).status, 404);
  const originalFetch = globalThis.fetch;
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalEmailFrom = process.env.EMAIL_FROM;
  let notificationCalls = 0;
  globalThis.fetch = async () => { notificationCalls += 1; throw new Error("Notificação de registro excluído não pode sair do processo."); };
  process.env.RESEND_API_KEY = "fixture-notification-key";
  process.env.EMAIL_FROM = "fixture@example.com";
  try {
    for (const [suffix, method, input] of [
      ["tracking", "GET", undefined], ["tracking", "POST", { action: "generate" }],
      ["tracking", "PATCH", { estimatedCompletionAt: new Date(Date.now() + 3600000).toISOString() }],
      ["tracking", "DELETE", undefined],
      ["notify", "POST", { channel: "whatsapp" }], ["notify", "POST", { channel: "email" }],
    ] as const) assert.equal((await request(`${route}/${suffix}`, method, input)).status, 404, `${method} ${suffix}`);
    assert.equal(notificationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendKey;
    if (originalEmailFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = originalEmailFrom;
  }
  assert.equal((await request(route, "PATCH", { action: "confirm", estimatedCompletionAt: new Date(Date.now() + 3600000).toISOString() })).status, 404);

  identity = clientIdentity("api-delete-owner");
  const ownList = await (await request("appointments/me")).json();
  assert.equal(ownList.items.some((item: { _id: string }) => item._id === String(appointment._id)), false);
});

test("API real: logs são administrativos, paginados, imutáveis pela API e sem segredos de clientes", async () => {
  identity = clientIdentity("api-audit-view-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const event = await Audit.findOne({ action: "appointment_deleted", adminClerkId: "api-delete-admin" }).lean();
  assert.ok(event);
  const endpoint = `admin/audit?action=appointment_deleted&appointmentId=${event.appointmentId}&page=1`;
  const response = await request(endpoint);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  const payload = await response.json();
  assert.equal(payload.total, 1);
  assert.equal(payload.page, 1);
  assert.equal(payload.pages, 1);
  assert.equal(payload.items.length, 1);
  const entry = payload.items[0];
  assert.equal(entry._id, String(event._id));
  assert.equal(entry.action, "appointment_deleted");
  assert.equal(entry.adminClerkId, "api-delete-admin");
  assert.equal(entry.actorName, "Cliente API");
  assert.equal(entry.reason, "Registro duplicado confirmado pelo administrador");
  assert.equal(entry.appointmentId, String(event.appointmentId));
  assert.equal(entry.details.serviceName, "Lavagem da exclusão");
  assert.equal(entry.details.vehicle.plate, "DEL2A23");
  const text = JSON.stringify(payload);
  for (const privateValue of ["5585999123456", "Nota privada da exclusão", "private-original-admin", "private-finance-admin", "Nota financeira privada da exclusão"])
    assert.equal(text.includes(privateValue), false, privateValue);
  for (const privateField of ["trackingToken", "trackingTokenHash", "guestPhone", "email", "deletionReason"])
    assert.equal(text.includes(`\"${privateField}\"`), false, privateField);
  for (const method of ["POST", "PATCH", "DELETE"] as const)
    assert.equal((await request("admin/audit", method, { _id: String(event._id), reason: "Tentativa de adulteração" })).status, 404, method);
  assert.equal((await Audit.findById(event._id)).reason, event.reason);
  for (const query of ["page=0", "appointmentId=invalid", "action=%24where", "action=appointment_deleted%3Bdelete"])
    assert.equal((await request(`admin/audit?${query}`)).status, 400, query);
  identity = clientIdentity("api-audit-ordinary-client");
  assert.equal((await request(endpoint)).status, 403);
  identity = null;
  assert.equal((await request(endpoint)).status, 401);
});

test("API real: fila consulta datas futuras e aprovação conserva atendimento no período com previsão", async () => {
  identity = clientIdentity("api-future-queue-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const appointment = await Appointment.create({
    guestName: "Cliente de agendamento futuro", vehicle: { model: "Onix futuro", plate: "FUT1A23", type: "small" },
    serviceName: "Lavagem futura", scheduledAt: new Date("2026-11-05T14:00:00Z"), status: "pending", quotedPrice: 50,
  });
  const queueRoute = "admin/queue?range=day&date=2026-11-05&page=1";
  const initial = await (await request(queueRoute)).json();
  assert.ok(initial.items.some((item: { _id: string; status: string }) => item._id === String(appointment._id) && item.status === "pending"));
  const estimatedCompletionAt = "2026-11-06T02:17:00.000Z";
  assert.equal((await request(`admin/appointments/${appointment._id}`, "PATCH", { action: "confirm" })).status, 400);
  const approvedResponse = await request(`admin/appointments/${appointment._id}`, "PATCH", { action: "confirm", estimatedCompletionAt });
  assert.equal(approvedResponse.status, 200, JSON.stringify(await approvedResponse.clone().json()));
  const approved = await approvedResponse.json();
  assert.equal(approved.status, "confirmed");
  assert.equal(approved.estimatedCompletionAt, estimatedCompletionAt);
  const after = await (await request(queueRoute)).json();
  assert.ok(after.items.some((item: { _id: string; status: string }) => item._id === String(appointment._id) && item.status === "confirmed"));
  assert.equal(after.counts.confirmed, 1);
  const physical = await (await request("admin/queue")).json();
  assert.equal(physical.items.some((item: { _id: string }) => item._id === String(appointment._id)), false);
  await Appointment.insertMany(Array.from({ length: 205 }, (_, index) => ({
    guestName: `Cliente futuro ${index}`, vehicle: { model: "Modelo futuro", plate: "FUT2A23", type: "small" },
    serviceName: "Lavagem futura", scheduledAt: new Date(+new Date("2026-11-08T12:00:00Z") + index * 60000),
    status: "confirmed", quotedPrice: 50,
  })));
  const pages = await Promise.all([1, 2, 3].map(async page => {
    const response = await request(`admin/queue?range=day&date=2026-11-08&page=${page}`);
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.deepEqual(pages.map(page => page.items.length), [100, 100, 5]);
  for (const page of pages) { assert.equal(page.total, 205); assert.equal(page.pages, 3); assert.equal(page.counts.confirmed, 205); }
  assert.equal(new Set(pages.flatMap(page => page.items.map((item: { _id: string }) => item._id))).size, 205);
  const summary = await (await request("admin/control?range=month&date=2026-11-05")).json();
  assert.equal(summary.total, 206);
  assert.equal(summary.confirmed, 206);
  for (const query of ["range=year&date=2026-11-05", "range=day&date=2026-02-30", "from=2026-11-08", "from=2026-11-09&to=2026-11-08", "range=month&date=2026-11-05&page=0", "status=forged", `search=${"x".repeat(101)}`])
    assert.equal((await request(`admin/queue?${query}`)).status, 400, query);
  for (const query of ["status=forged", `search=${"x".repeat(101)}`])
    assert.equal((await request(`admin/control?${query}`)).status, 400, query);
  const filteredPages = await Promise.all([1, 2, 3].map(async page => {
    const response = await request(`admin/queue?date=2026-11-08&range=day&page=${page}&search=Cliente%20futuro&status=confirmed`);
    assert.equal(response.status, 200);return response.json();
  }));
  assert.deepEqual(filteredPages.map(page => page.items.length), [100, 100, 5]);
  for (const page of filteredPages) { assert.equal(page.total, 205);assert.equal(page.counts.confirmed, 205); }
  assert.equal((await (await request("admin/control?date=2026-11-08&search=Cliente%20futuro&status=confirmed")).json()).total, 205);
  assert.equal((await (await request("admin/queue?date=2026-11-08&search=%28.%2A%7C%5E%29")).json()).total, 0);
  const customer = await User.create({ clerkId: "api-queue-name-target", name: "Cliente API [fila].*", phone: "5585999123456" });
  const [onSite, guest, returned] = await Appointment.create([
    { userId: customer._id, vehicle: { model: "Modelo buscado", plate: "SRC1A23", type: "small" }, serviceName: "Lavagem", scheduledAt: new Date("2050-11-08T14:00:00Z"), arrivedAt: new Date("2050-11-08T14:01:00Z"), status: "arrived", quotedPrice: 50 },
    { guestName: "Cliente API [fila].*", vehicle: { model: "Modelo avulso", plate: "SRC2A23", type: "small" }, serviceName: "Lavagem", scheduledAt: new Date("2050-11-07T14:00:00Z"), arrivedAt: new Date("2050-11-07T14:01:00Z"), status: "arrived", quotedPrice: 50 },
    { userId: customer._id, vehicle: { model: "Modelo devolvido", plate: "SRC3A23", type: "small" }, serviceName: "Lavagem", scheduledAt: new Date("2050-11-07T14:00:00Z"), arrivedAt: new Date("2050-11-07T14:01:00Z"), returnedAt: new Date("2050-11-08T14:01:00Z"), status: "returned", quotedPrice: 50 },
  ]);
  const beforeSearch = await (await request("admin/queue")).json();
  const searched = await (await request("admin/queue?search=Cliente%20API%20%5Bfila%5D.%2A&status=arrived")).json();
  assert.deepEqual(new Set(searched.items.map((item: { _id: string }) => item._id)), new Set([onSite, guest].map(item => String(item._id))));
  for (const item of searched.items) assert.equal(item.queuePosition, beforeSearch.items.find((original: { _id: string }) => original._id === item._id).queuePosition);
  const plate = await (await request("admin/queue?search=SRC-1A23")).json();
  assert.deepEqual(plate.items.map((item: { _id: string }) => item._id), [String(onSite._id)]);
  const historicalQuery = "date=2050-11-08&criterion=delivered&status=returned&search=Cliente%20API%20%5Bfila%5D.%2A";
  const history = await (await request(`admin/queue?${historicalQuery}`)).json();
  const historySummary = await (await request(`admin/control?${historicalQuery}`)).json();
  assert.deepEqual(history.items.map((item: { _id: string }) => item._id), [String(returned._id)]);
  assert.equal(history.total, 1);assert.equal(historySummary.total, 1);assert.equal(historySummary.returned, 1);
});

test("API real: calendário conta todos os atendimentos do período antes da paginação e respeita o filtro", async () => {
  identity = clientIdentity("api-complete-calendar-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const dates = Array.from({ length: 141 }, (_, index) => index < 41 ? "2040-10-05T14:00:00Z" : "2040-10-10T14:00:00Z");
  await Appointment.insertMany(dates.map((scheduledAt, index) => ({
    vehicle: { model: "Calendário completo", plate: "CAL1A23", type: "small" }, serviceName: "Lavagem de calendário",
    scheduledAt: new Date(scheduledAt), status: index < 41 ? "confirmed" : "delivered", quotedPrice: 50,
  })));
  await Appointment.create({ vehicle: { model: "Excluído do calendário", plate: "CAL2A23", type: "small" },
    scheduledAt: new Date("2040-10-05T14:00:00Z"), status: "confirmed", deletedAt: new Date() });
  const all = await request("admin/appointments/calendar?date=2040-10-05&range=month");
  assert.equal(all.status, 200);
  const payload = await all.json();
  assert.equal(payload.total, 141);
  assert.equal(payload.days.find((day: { date: string; total: number }) => day.date === "2040-10-05").total, 41);
  assert.equal(payload.days.find((day: { date: string; total: number }) => day.date === "2040-10-10").total, 100);
  assert.equal(JSON.stringify(payload).includes("CAL1A23"), false);
  const filtered = await (await request("admin/appointments/calendar?date=2040-10-05&range=month&status=confirmed")).json();
  assert.equal(filtered.total, 41);
  assert.equal(filtered.days.find((day: { date: string; total: number }) => day.date === "2040-10-05").total, 41);
  assert.ok(filtered.days.every((day: { date: string; total: number }) => day.date !== "2040-10-10" || day.total === 0));

  const statuses = ["pending", "confirmed", "arrived", "in_progress", "ready", "completed", "delivered", "cancelled", "rejected", "returned"];
  await Appointment.insertMany(Array.from({ length: 31 }, (_, index) => ({
    vehicle: { model: "Calendário de dezembro", plate: "CAL3A23", type: "small" },
    scheduledAt: new Date(`2040-12-${String(index + 1).padStart(2, "0")}T14:00:00Z`), status: statuses[index % statuses.length],
  })));
  const month = await (await request("admin/appointments/calendar?date=2040-12-15&range=month")).json();
  assert.equal(month.total, 31);
  assert.equal(month.days.length, 31);
  for (let day = 1; day <= 31; day++) assert.equal(month.days.find((item: { date: string; total: number }) => item.date === `2040-12-${String(day).padStart(2, "0")}`).total, 1);
  for (const status of statuses) {
    const response = await request(`admin/appointments/calendar?date=2040-12-15&range=month&status=${status}`);
    assert.equal(response.status, 200, status);
    assert.equal((await response.json()).total, status === "pending" ? 4 : 3);
  }
  for (const query of ["date=2040-02-30", "range=year&date=2040-12-15", "status=admin&date=2040-12-15"])
    assert.equal((await request(`admin/appointments/calendar?${query}`)).status, 400, query);
});

test("API real: relatório operacional consulta finalização e entrega sem depender de pagamento", async () => {
  identity = clientIdentity("api-service-report-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const readyAt = new Date("2042-03-05T03:00:00Z");
  const base = { guestName: "Cliente do relatório operacional", vehicle: { model: "Onix do relatório", plate: "REP1A23", type: "small" },
    serviceName: "Lavagem do relatório", serviceCategory: "api_service_report", quotedPrice: 70,
    scheduledAt: new Date("2042-03-04T22:00:00Z"), arrivedAt: new Date("2042-03-04T22:10:00Z"),
    readyAt, notes: "Observação interna não exportável", guestPhone: "5585999129999" };
  const [unpaid, delivered, wrongDay] = await Appointment.create([
    { ...base, status: "ready" },
    { ...base, status: "delivered", deliveredAt: new Date("2042-03-06T03:00:00Z"), deletedAt: new Date(), finalPrice: 50 },
    { ...base, status: "ready", readyAt: new Date(+readyAt - 1) },
  ]);
  const endpoint = "admin/service-report?range=day&date=2042-03-05&criterion=ready&category=api_service_report";
  const response = await request(endpoint);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  const report = await response.json();
  assert.equal(report.total, 2);
  assert.equal(report.summary.unpaid, 2);
  assert.equal(report.summary.totalReceived, 0);
  assert.equal(report.items.find((entry: { _id: string }) => entry._id === String(unpaid._id)).balance, 70);
  assert.equal(report.items.find((entry: { _id: string }) => entry._id === String(delivered._id)).deleted, true);
  assert.equal(report.items.some((entry: { _id: string }) => entry._id === String(wrongDay._id)), false);
  for (const privateValue of [base.notes, base.guestPhone]) assert.equal(JSON.stringify(report).includes(privateValue), false);
  const byDelivery = await (await request("admin/service-report?range=day&date=2042-03-06&criterion=delivered&category=api_service_report")).json();
  assert.deepEqual(byDelivery.items.map((entry: { _id: string }) => entry._id), [String(delivered._id)]);
  for (const query of ["criterion=paid", "date=2042-02-30", "from=2042-03-06&to=2042-03-05", "page=0"])
    assert.equal((await request(`admin/service-report?${query}`)).status, 400, query);
});

test("API real: correção financeira preserva o original e exige corpo estrito, motivo e identidade de servidor", async () => {
  identity = clientIdentity("api-correction-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const original = await Transaction.create({ date: new Date(Date.now() - 3600000), description: "Recibo da correção API",
    category: "api_correction", source: "manual", amount: 100, paymentMethod: "pix", createdBy: "original-fixture-admin" });
  const endpoint = `admin/transactions/${original._id}/correction`;
  const valid = { action: "correct", correctedAmount: 38, reason: "Correção conferida pelo administrador", requestId: randomUUID() };
  for (const input of [
    { ...valid, reason: "x" }, { ...valid, requestId: "previsível" }, { ...valid, correctedAmount: 3.333 },
    { ...valid, createdBy: "admin-forjado" }, { ...valid, adminClerkId: "admin-forjado" },
    { ...valid, _id: id }, { ...valid, source: "manual" }, { ...valid, $set: { amount: 0 } },
  ]) assert.equal((await request(endpoint, "POST", input)).status, 400, JSON.stringify(input));
  assert.equal((await request(endpoint, "POST", valid, { Origin: "https://evil.example" })).status, 403);
  assert.equal(await Transaction.countDocuments({ correctionOf: original._id }), 0);
  const corrected = await request(endpoint, "POST", valid);
  assert.equal(corrected.status, 201);
  const entry = await corrected.json();
  assert.equal(entry.amount, -62);
  assert.equal(entry.netAmount, 38);
  assert.equal(entry.createdBy, identity.id);
  assert.equal(entry.correctionOf, String(original._id));
  const storedOriginal = await Transaction.findById(original._id);
  assert.equal(storedOriginal.amount, 100);
  assert.equal(storedOriginal.createdBy, "original-fixture-admin");
  const audit = await Audit.findOne({ transactionId: original._id, action: "payment_corrected" });
  assert.equal(audit.adminClerkId, identity.id);
  assert.equal(audit.reason, valid.reason);
  assert.equal(audit.before, 100);
  assert.equal(audit.after, 38);
  const retry = await request(endpoint, "POST", valid);
  assert.equal(retry.status, 201);
  assert.equal((await retry.json())._id, entry._id);
  assert.equal((await request(endpoint, "POST", { ...valid, correctedAmount: 40 })).status, 409);
  assert.equal(await Transaction.countDocuments({ correctionOf: original._id }), 1);
  assert.equal(await Audit.countDocuments({ transactionId: original._id, action: "payment_corrected" }), 1);
  const listing = await (await request("admin/transactions?category=api_correction")).json();
  assert.equal(listing.items.find((item: { _id: string }) => item._id === String(original._id)).netAmount, 38);
  assert.equal((await request(`admin/transactions/${id}/correction`, "POST", valid)).status, 404);
});

test("API real: repetir envio de agendamento retorna um único atendimento e recusa reutilização com outros dados", async () => {
  identity = clientIdentity("api-idempotent-booking-client");
  assert.equal((await request("profile/me", "PATCH", { name: "Cliente do envio único", phone: "85999123456" })).status, 200);
  const customer = await User.findOne({ clerkId: identity.id });
  const service = await Service.findOne({ slug: "simples", active: true });
  const input = { vehicle: { model: "Onix do envio único", plate: "ENV1A23", type: "small" },
    serviceId: String(service._id), scheduledAt: new Date(Date.now() + 5 * 86400000).toISOString(), consent: true,
    notes: "Solicitação original", requestId: randomUUID() };
  for (const extra of [{ requestId: "invalid" }, { createdBy: "admin" }, { userId: id }, { role: "admin" }])
    assert.equal((await request("appointments", "POST", { ...input, ...extra })).status, 400);
  const first = await request("appointments", "POST", input);
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  const appointment = await first.json();
  const repeated = await request("appointments", "POST", input);
  assert.equal(repeated.status, 201);
  assert.equal((await repeated.json())._id, appointment._id);
  assert.equal((await request("appointments", "POST", { ...input, notes: "Outra solicitação" })).status, 409);
  assert.equal(await Appointment.countDocuments({ userId: customer._id }), 1);
  assert.equal(await Audit.countDocuments({ appointmentId: appointment._id, action: "booking_created" }), 1);
  assert.equal((await User.findById(customer._id)).vehicles.length, 1);
  assert.equal(appointment.requestId, undefined);
});

test("API real: cupom e lançamento manual repetidos não duplicam registros e não aceitam reutilização alterada", async () => {
  identity = clientIdentity("api-idempotent-manual-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const customer = await User.create({ clerkId: "api-idempotent-coupon-owner", name: "Cliente do cupom único", phone: "5585999127777" });
  const cases = [
    { endpoint: "admin/coupons", input: { userId: String(customer._id), vehicle: { model: "Onix de cupom", plate: "ENV2A23", type: "small" },
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), reason: "Cortesia autorizada para o cliente", requestId: randomUUID() },
      changed: { reason: "Outro motivo para nova cortesia" } },
    { endpoint: "admin/transactions", input: { userId: String(customer._id), description: "Recebimento do envio único", category: "api_single_transaction",
      amount: 50, paymentMethod: "pix", date: new Date(Date.now() - 1000).toISOString(), requestId: randomUUID() }, changed: { amount: 60 } },
  ];
  for (const { endpoint, input, changed } of cases) {
    for (const extra of [{ createdBy: "admin-forjado" }, { _id: id }, { requestId: "invalid" }])
      assert.equal((await request(endpoint, "POST", { ...input, ...extra })).status, 400, endpoint);
    const first = await request(endpoint, "POST", input);
    assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
    const result = await first.json();
    const repeated = await request(endpoint, "POST", input);
    assert.equal(repeated.status, 201);
    assert.equal((await repeated.json())._id, result._id);
    assert.equal((await request(endpoint, "POST", { ...input, ...changed })).status, 409);
    assert.equal(result.requestId, undefined);
  }
  assert.equal(await Coupon.countDocuments({ userId: customer._id }), 1);
  assert.equal(await Transaction.countDocuments({ category: "api_single_transaction" }), 1);
  assert.equal(await Audit.countDocuments({ userId: customer._id, action: "manual_coupon" }), 1);
  assert.equal(await Audit.countDocuments({ userId: customer._id, action: "manual_transaction" }), 1);
});

test("API real: operações de ausência e expiração de agendamento permanecem indisponíveis", async () => {
  identity = clientIdentity("api-unapproved-operation-admin");
  identity.emailAddresses[0].emailAddress = "admin-api@example.com";
  const appointment = await Appointment.create({ vehicle: { model: "Onix sem ausência automática", plate: "ENV3A23", type: "small" },
    serviceName: "Atendimento preservado", scheduledAt: new Date(Date.now() - 86400000), status: "confirmed" });
  for (const suffix of ["no-show", "expire"])
    assert.equal((await request(`admin/appointments/${appointment._id}/${suffix}`, "POST", { reason: "Operação fora da aprovação" })).status, 404);
  assert.equal((await Appointment.findById(appointment._id)).status, "confirmed");
});
