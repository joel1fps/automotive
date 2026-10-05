import { test } from "node:test";
import assert from "node:assert/strict";
import {
  couponMatches,
  expiryForReward,
  filterBounds,
  localSlots,
  loyaltyStep,
  periodBounds,
  sumMoney,
  validAppointmentTime,
  validRequestedTime,
} from "../src/lib/domain";
import { defaultSettings, initialServices } from "../src/lib/catalog";
import {
  bookingSchema,
  clientSchema,
  dateSchema,
  manualBookingSchema,
  settingsSchema,
  actionSchema,
} from "../src/lib/validation";
test("Chegada avulsa informa o erro de telefone e preserva contato opcional", () => {
  const walkIn = {
    walkIn: true,
    guestName: "Joel222",
    serviceId: "a".repeat(24),
    vehicle: { model: "Onix", plate: "KTZ-7H11", type: "pickup" },
    notes: "teste",
  };
  const invalid = manualBookingSchema.safeParse({ ...walkIn, guestPhone: "8999248167" });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.deepEqual(invalid.error.issues[0].path, ["guestPhone"]);
    assert.match(invalid.error.issues[0].message, /Informe um telefone brasileiro válido com DDD/);
    assert.notEqual(invalid.error.issues[0].message, "Invalid input");
  }
  assert.equal(manualBookingSchema.parse(walkIn).guestPhone, undefined);
  assert.equal(manualBookingSchema.parse({ ...walkIn, guestPhone: "   " }).guestPhone, "");
  assert.equal(manualBookingSchema.parse({ ...walkIn, guestPhone: "(89) 99924-8167" }).guestPhone, "5589999248167");
  assert.equal(manualBookingSchema.parse({ ...walkIn, guestPhone: "(89) 3248-1670" }).guestPhone, "558932481670");
});

test("Edição do cliente preserva mensagem do telefone e permite apagar contato", () => {
  const invalid = clientSchema.safeParse({ phone: "8999248167", vehicles: [] });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.deepEqual(invalid.error.issues[0].path, ["phone"]);
    assert.match(invalid.error.issues[0].message, /Informe um telefone brasileiro válido com DDD/);
  }
  assert.equal(clientSchema.parse({ phone: "", vehicles: [] }).phone, "");
  assert.equal(clientSchema.parse({ phone: "+55 (89) 99924-8167", vehicles: [] }).phone, "5589999248167");
});
test("Os nove preços conferem com a tabela fornecida", () => {
  assert.deepEqual(
    initialServices.slice(0, 3).map((s) => s.prices),
    [
      { small: 30, suv: 40, pickup: 50 },
      { small: 50, suv: 65, pickup: 80 },
      { small: 60, suv: 75, pickup: 90 },
    ],
  );
});
test("10ª lavagem emite um cupom e a 11ª mantém o excedente", () => {
  const tenth = loyaltyStep(9, true);
  assert.deepEqual(tenth, { count: 0, issue: true });
  assert.deepEqual(loyaltyStep(tenth.count, true), { count: 1, issue: false });
  assert.deepEqual(loyaltyStep(7, false), { count: 7, issue: false });
});
test("Cupom de 30 dias exige mesma placa e tamanho", () => {
  const issued = new Date("2026-09-30T15:00:00Z");
  const coupon = {
    vehiclePlate: "ABC1D23",
    vehicleType: "small",
    expiresAt: expiryForReward(issued),
  };
  assert.equal(coupon.expiresAt.toISOString(), "2026-10-30T15:00:00.000Z");
  assert.equal(
    couponMatches(
      coupon,
      { plate: "ABC1D23", type: "small" },
      new Date("2026-10-01"),
    ),
    true,
  );
  assert.equal(
    couponMatches(
      coupon,
      { plate: "XYZ1234", type: "small" },
      new Date("2026-10-01"),
    ),
    false,
  );
  assert.equal(
    couponMatches(
      coupon,
      { plate: "ABC1D23", type: "suv" },
      new Date("2026-10-01"),
    ),
    false,
  );
  assert.equal(
    couponMatches(
      coupon,
      { plate: "ABC1D23", type: "small" },
      new Date("2026-10-31"),
    ),
    false,
  );
});
test("Horários legados respeitam expediente e America/Fortaleza", () => {
  const slots = localSlots("2026-10-01", defaultSettings);
  assert.equal(slots.length, 9);
  assert.equal(slots[0].toISOString(), "2026-10-01T11:00:00.000Z");
  assert.equal(slots.at(-1)?.toISOString(), "2026-10-01T19:00:00.000Z");
  assert.equal(validAppointmentTime(new Date("2026-10-01T20:00:00Z"), defaultSettings, new Date("2026-09-30")), false);
  assert.equal(localSlots("2026-10-04", defaultSettings).length, 0);
  assert.equal(
    validAppointmentTime(
      new Date("2026-10-01T11:30:00Z"),
      defaultSettings,
      new Date("2026-09-30"),
    ),
    true,
  );
});
test("Solicitações novas aceitam qualquer minuto futuro, domingo e madrugada", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  assert.equal(validRequestedTime(new Date("2026-10-04T02:17:00-03:00"), now), true);
  assert.equal(validRequestedTime(new Date("2026-10-01T19:43:00-03:00"), now), true);
  assert.equal(validRequestedTime(now, now), false);
  assert.equal(validRequestedTime(new Date(+now - 1), now), false);
  assert.equal(validRequestedTime(new Date("invalid"), now), false);
});
test("Aprovar exige previsão ISO e não aceita identidade administrativa no corpo", () => {
  assert.equal(actionSchema.safeParse({ action: "confirm" }).success, false);
  assert.equal(actionSchema.safeParse({ action: "confirm", estimatedCompletionAt: "2026-10-04T13:17:00-03:00" }).success, true);
  assert.equal(actionSchema.safeParse({ action: "confirm", estimatedCompletionAt: "amanhã" }).success, false);
  assert.equal(actionSchema.safeParse({ action: "confirm", estimatedCompletionAt: "2026-10-04T13:17:00-03:00", adminClerkId: "fake" }).success, false);
  assert.equal(actionSchema.safeParse({ action: "reschedule", scheduledAt: "2026-10-04T13:17:00-03:00", estimatedCompletionAt: "2026-10-04T14:17:00-03:00" }).success, true);
});
test("Agendamento manual exige previsão de entrega; chegada avulsa mantém essa previsão opcional", () => {
  const input = { serviceId: "a".repeat(24), guestName: "Cliente manual", vehicle: { model: "Onix", plate: "MAN1A23", type: "small" },
    scheduledAt: "2030-01-07T12:00:00Z" };
  const invalid = manualBookingSchema.safeParse(input);
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.ok(invalid.error.issues.some(issue => /previsão de entrega/.test(issue.message)));
  assert.equal(manualBookingSchema.safeParse({ ...input, estimatedCompletionAt: "2030-01-07T15:00:00Z" }).success, true);
  assert.equal(manualBookingSchema.safeParse({ ...input, scheduledAt: undefined, walkIn: true }).success, true);
  assert.equal(manualBookingSchema.safeParse({ ...input, estimatedCompletionAt: "2030-01-07T15:00:00Z", requestId: "id-escolhido-sem-formato" }).success, false);
});
test("Devolução exige motivo significativo e rejeita pagamento ou identidade enviados no corpo", () => {
  for (const reason of [undefined, "", "     ", "abcd", "x".repeat(501), { $ne: null }])
    assert.equal(actionSchema.safeParse({ action: "return", reason }).success, false);
  assert.deepEqual(actionSchema.parse({ action: "return", reason: "  Cliente retirou antes da execução  " }), { action: "return", reason: "Cliente retirou antes da execução" });
  for (const extra of [{ adminClerkId: "forjado" }, { finalPrice: 50 }, { returnedAt: "2030-01-07T15:00:00Z" }, { status: "delivered" }])
    assert.equal(actionSchema.safeParse({ action: "return", reason: "Retirada pelo cliente", ...extra }).success, false);
});
test("Períodos financeiros têm limites locais, incluindo virada de mês", () => {
  assert.equal(
    periodBounds("day", "2026-09-30").from.toISOString(),
    "2026-09-30T03:00:00.000Z",
  );
  assert.equal(
    periodBounds("month", "2026-09-30").to.toISOString(),
    "2026-10-01T03:00:00.000Z",
  );
  assert.equal(
    periodBounds("week", "2026-09-30").from.toISOString(),
    "2026-09-28T03:00:00.000Z",
  );
  assert.equal(
    filterBounds("2026-09-01", "2026-09-30").to.toISOString(),
    "2026-10-01T03:00:00.000Z",
  );
});
test("Dinheiro usa centavos, sem erro de ponto flutuante", () =>
  assert.equal(sumMoney([0.1, 0.2, 50]), 50.3));
test("Validação rejeita datas inexistentes e regra de cupom incorreta", () => {
  assert.equal(dateSchema.safeParse("2026-02-31").success, false);
  assert.equal(
    settingsSchema.safeParse({ ...defaultSettings, couponValidityDays: 90 })
      .success,
    false,
  );
  assert.equal(
    bookingSchema.safeParse({
      serviceId: "a".repeat(24),
      vehicle: { model: "Onix", plate: "abc-1234", type: "small" },
      scheduledAt: "2026-10-01T11:00:00Z",
      consent: false,
    }).success,
    false,
  );
});

test("Serviço à parte (Outros) exige descrição e valor, sem cupom e sem serviço do catálogo", async () => {
  const { manualBookingSchema } = await import("../src/lib/validation");
  const base = {
    vehicle: { model: "Onix", plate: "ABC1D23", type: "small" as const },
    scheduledAt: "2030-01-07T12:00:00.000Z",
    estimatedCompletionAt: "2030-01-07T15:00:00.000Z",
    guestName: "Cliente Avulso",
  };
  const ok = manualBookingSchema.safeParse({
    ...base,
    custom: { description: "Polimento à parte", price: 350.5 },
  });
  assert.equal(ok.success, true);
  assert.equal(manualBookingSchema.safeParse(base).success, false);
  assert.equal(
    manualBookingSchema.safeParse({
      ...base,
      custom: { description: "", price: 100 },
    }).success,
    false,
  );
  assert.equal(
    manualBookingSchema.safeParse({
      ...base,
      serviceId: "a".repeat(24),
      custom: { description: "PPF", price: 100 },
    }).success,
    false,
  );
  assert.equal(
    manualBookingSchema.safeParse({
      ...base,
      custom: { description: "PPF", price: 100 },
      couponId: "b".repeat(24),
    }).success,
    false,
  );
});
import { notificationText } from '../src/lib/notifications';
import { serviceSchema } from '../src/lib/validation';
test('Avisos incluem o serviço e não anunciam retirada antes da etapa correta',()=>{
 const appointment={status:'in_progress',serviceName:'Polimento',vehicle:{model:'Onix',plate:'ABC1D23'}};
 assert.match(notificationText(appointment),/Começamos agora.*Polimento/);
 assert.match(notificationText({...appointment,status:'ready'}),/pronto para retirada/);
 assert.throws(()=>notificationText({...appointment,status:'pending'}));
});
test('Imagens de serviço aceitam HTTPS e rejeitam esquemas executáveis',()=>{
 const service={name:'Polimento',slug:'polimento',category:'extra',prices:null,countsForLoyalty:false,active:true};
 assert.equal(serviceSchema.safeParse({...service,imageUrl:'https://example.com/image.webp'}).success,true);
 assert.equal(serviceSchema.safeParse({...service,imageUrl:'javascript:alert(1)'}).success,false);
});

test("Catálogo permite remover restrições de veículo sem omitir a atualização", () => {
  const service = {
    name: "Polimento",
    slug: "polimento",
    category: "extra",
    prices: null,
    countsForLoyalty: false,
    active: true,
  };
  const unrestricted = serviceSchema.parse({ ...service, vehicleTypes: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(unrestricted)).vehicleTypes, []);
  assert.equal(Object.hasOwn(serviceSchema.parse(service), "vehicleTypes"), false);
  assert.deepEqual(
    serviceSchema.parse({ ...service, vehicleTypes: ["moto"] }).vehicleTypes,
    ["moto"],
  );
  assert.equal(
    serviceSchema.safeParse({ ...service, vehicleTypes: ["truck"] }).success,
    false,
  );
});
