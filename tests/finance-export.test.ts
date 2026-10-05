import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { SaxesParser } from "saxes";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Appointment, Transaction, User, connectDB } from "../src/lib/db";
import { completeWorkbook, financeSummary, financeWorkbook, financeXml, servicesReport, servicesWorkbook, servicesXml, type FinanceFilter, type ServiceFilter } from "../src/lib/finance";
import { periodBounds } from "../src/lib/domain";
import { statusLabels } from "../src/lib/catalog";
import { appointmentStatuses } from "../src/lib/appointment-state";

let server: MongoMemoryReplSet;
before(async () => {
  server = await MongoMemoryReplSet.create({
    replSet: { count: 1 }, binary: { version: "8.0.13" },
  });
  process.env.MONGODB_URI = server.getUri();
  await connectDB();
  await Promise.all([Appointment, Transaction, User].map((model) => model.init()));
}, { timeout: 240000 });
after(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
afterEach(async () => {
  // This process owns a private replica set; no application database is used.
  await Promise.all([Appointment, Transaction, User].map((model) => model.deleteMany({})));
});

const paymentDate = new Date("2026-10-02T01:30:00Z"); // 1 October, 22:30 in Fortaleza.
const filter: FinanceFilter = { ...periodBounds("day", "2026-10-01"), category: "wash", paymentMethod: "pix" };
async function exportedSheet(input = filter) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await financeWorkbook(input) as never);
  return book.getWorksheet("Entradas")!;
}
async function guestReceipt(snapshot = true) {
  const appointment = await Appointment.create({
    guestName: "Nome alterado no atendimento",
    vehicle: { model: "Modelo alterado", plate: "NEW2A34", type: "small" },
    serviceName: "Serviço alterado",
    scheduledAt: new Date("2026-10-03T13:00:00Z"),
    arrivedAt: new Date("2026-10-01T14:00:00Z"),
    startedAt: new Date("2026-10-01T14:10:00Z"),
    readyAt: new Date("2026-10-01T14:40:00Z"),
    completedAt: paymentDate,
    status: "completed",
  });
  const receipt = await Transaction.create({
    appointmentId: appointment._id,
    date: paymentDate,
    description: "Lavagem simples",
    category: "wash",
    source: "appointment",
    amount: 50.25,
    paymentMethod: "pix",
    ...(snapshot ? {
      clientName: "Cliente do recibo", vehiclePlate: "ABC1D23",
      vehicleModel: "Onix do recibo", serviceName: "Lavagem do recibo",
    } : {}),
  });
  return { appointment, receipt };
}

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlNode[];
};
function parsedXml(source: string) {
  const parser = new SaxesParser({ xmlns: false });
  const nodes: XmlNode[] = [];
  let root: XmlNode | undefined;
  parser.on("opentag", (tag) => {
    const node: XmlNode = { name: tag.name, attributes: { ...tag.attributes }, text: "", children: [] };
    if (nodes.length) nodes.at(-1)!.children.push(node);
    else root = node;
    nodes.push(node);
  });
  parser.on("text", (text) => { if (nodes.length) nodes.at(-1)!.text += text; });
  parser.on("closetag", () => { nodes.pop(); });
  parser.on("doctype", () => { assert.fail("A exportação não pode declarar entidades externas"); });
  parser.on("error", (error) => { throw error; });
  parser.write(source).close();
  assert.ok(root);
  return root;
}
function child(node: XmlNode, name: string) {
  const found = node.children.find((candidate) => candidate.name === name);
  assert.ok(found, `Elemento XML ausente: ${name}`);
  return found;
}

test("XML exporta cliente, veículo, serviço, valor e todas as datas operacionais em ISO com fuso", async () => {
  const { appointment, receipt } = await guestReceipt();
  // Operational details are projected; secrets and internal notes must be absent.
  await Appointment.updateOne({ _id: appointment._id }, { $set: {
    guestPhone: "85999999999", notes: "NOTA_INTERNA_INACESSIVEL",
    trackingToken: "TOKEN_INACESSIVEL", trackingTokenHash: "HASH_INACESSIVEL",
  } });
  const source = await financeXml(filter);
  const root = parsedXml(source);
  assert.equal(root.name, "automotive");
  assert.equal(root.attributes.versao, "1.0");
  const metadata = child(root, "metadados");
  assert.equal(child(metadata, "fuso_horario").text, "America/Fortaleza");
  assert.deepEqual(child(metadata, "periodo").attributes, {
    inicio_inclusivo: "2026-10-01T00:00:00.000-03:00", fim_exclusivo: "2026-10-02T00:00:00.000-03:00",
  });
  assert.equal(child(metadata, "criterio_periodo").text, "data_pagamento_lancamento");
  assert.equal(child(child(root, "resumo"), "quantidade").text, "1");
  assert.equal(child(child(root, "resumo"), "total").text, "50.25");
  const entry = child(child(root, "lancamentos"), "lancamento");
  assert.deepEqual(entry.attributes, { id: String(receipt._id), agendamento_id: String(appointment._id) });
  assert.equal(child(entry, "data_lancamento").text, "2026-10-01T22:30:00.000-03:00");
  assert.equal(child(entry, "cliente").text, "Cliente do recibo");
  assert.equal(child(entry, "servico").text, "Lavagem do recibo");
  assert.equal(child(child(entry, "veiculo"), "modelo").text, "Onix do recibo");
  assert.equal(child(child(entry, "veiculo"), "placa").text, "ABC1D23");
  assert.equal(child(entry, "valor").text, "50.25");
  assert.equal(child(entry, "valor").attributes.moeda, "BRL");
  assert.equal(child(entry, "forma_pagamento").text, "pix");
  assert.equal(child(entry, "categoria").text, "wash");
  assert.equal(child(entry, "origem").text, "appointment");
  const dates = child(entry, "datas");
  assert.deepEqual(Object.fromEntries(dates.children.map((node) => [node.name, node.text])), {
    agendamento: "2026-10-03T10:00:00.000-03:00", entrada: "2026-10-01T11:00:00.000-03:00",
    inicio_servico: "2026-10-01T11:10:00.000-03:00", conclusao_servico: "2026-10-01T11:40:00.000-03:00",
    pagamento: "2026-10-01T22:30:00.000-03:00", saida: "",
  });
  assert.equal(child(entry, "status").attributes.codigo, "completed");
  assert.equal(child(entry, "status").text, statusLabels.completed);
  assert.doesNotMatch(source, /TOKEN_INACESSIVEL|HASH_INACESSIVEL|NOTA_INTERNA_INACESSIVEL|85999999999/);
  await Appointment.updateOne({ _id: appointment._id }, { $set: {
    status: "delivered", deliveredAt: new Date("2026-10-02T02:00:00Z"),
  } });
  const delivered = child(child(parsedXml(await financeXml(filter)), "lancamentos"), "lancamento");
  assert.equal(child(child(delivered, "datas"), "saida").text, "2026-10-01T23:00:00.000-03:00");
  assert.equal(child(delivered, "status").attributes.codigo, "delivered");
});

test("XML respeita limites de dia, semana e mês em Fortaleza e os filtros sem paginação", async () => {
  const dates = [
    "2026-09-28T02:59:59.999Z", "2026-09-28T03:00:00Z", "2026-10-01T02:59:59.999Z",
    "2026-10-01T03:00:00Z", "2026-10-02T02:59:59.999Z", "2026-10-02T03:00:00Z",
    "2026-10-05T03:00:00Z", "2026-11-01T02:59:59.999Z", "2026-11-01T03:00:00Z",
  ];
  await Transaction.create(dates.map((date, index) => ({
    date: new Date(date), description: `Serviço ${index}`, category: "wash", source: "manual", amount: 1.25, paymentMethod: "pix",
  })));
  await Transaction.create([
    { date: paymentDate, description: "Excluir cartão", category: "wash", source: "manual", amount: 99, paymentMethod: "card" },
    { date: paymentDate, description: "Excluir extra", category: "extra", source: "manual", amount: 99, paymentMethod: "pix" },
  ]);
  for (const [range, indices] of [
    ["day", [3, 4]], ["week", [1, 2, 3, 4, 5]], ["month", [3, 4, 5, 6, 7]],
  ] as const) {
    const root = parsedXml(await financeXml({ ...periodBounds(range, "2026-10-01"), category: "wash", paymentMethod: "pix" }));
    assert.deepEqual(child(root, "lancamentos").children.map((entry) => child(entry, "servico").text),
      indices.map((index) => `Serviço ${index}`), range);
    assert.equal(child(child(root, "resumo"), "total").text, (indices.length * 1.25).toFixed(2));
  }
  await Transaction.create(Array.from({ length: 45 }, (_, index) => ({
    date: paymentDate, description: `Mais ${index}`, category: "wash", source: "manual", amount: 0.01, paymentMethod: "pix",
  })));
  const exported = parsedXml(await financeXml(filter));
  assert.equal(child(exported, "lancamentos").children.length, 47);
  assert.equal(child(child(exported, "resumo"), "quantidade").text, "47");
  assert.equal(child(child(exported, "resumo"), "total").text, "2.95");
});

test("XML preserva dados legados e manuais e mantém datas ausentes vazias", async () => {
  const { appointment } = await guestReceipt(false);
  const user = await User.create({ clerkId: "xml-legacy", name: "Cliente cadastrado" });
  await Transaction.create([
    { userId: user._id, date: new Date(+paymentDate + 1000), description: "Serviço manual", category: "wash", source: "manual", amount: 0, paymentMethod: "pix" },
    { appointmentId: new mongoose.Types.ObjectId(), clientName: "Snapshot preservado", vehiclePlate: "OLD1A23", vehicleModel: "Celta", date: new Date(+paymentDate + 2000), description: "Histórico", category: "wash", source: "appointment", amount: 35, paymentMethod: "pix" },
  ]);
  const entries = child(parsedXml(await financeXml(filter)), "lancamentos").children;
  assert.equal(entries.length, 3);
  assert.equal(entries[0].attributes.agendamento_id, String(appointment._id));
  assert.equal(child(entries[0], "cliente").text, "Nome alterado no atendimento");
  assert.equal(child(child(entries[0], "veiculo"), "placa").text, "NEW2A34");
  assert.equal(child(entries[1], "cliente").text, "Cliente cadastrado");
  assert.equal(child(entries[1], "valor").text, "0.00");
  assert.equal(child(entries[1], "origem").text, "manual");
  assert.equal(entries[1].attributes.agendamento_id, undefined);
  assert.equal(child(entries[2], "cliente").text, "Snapshot preservado");
  assert.equal(child(child(entries[2], "veiculo"), "modelo").text, "Celta");
  for (const entry of entries.slice(1)) {
    assert.equal(child(entry, "status").text, "");
    for (const date of child(entry, "datas").children) assert.equal(date.text, "");
  }
  const empty = parsedXml(await financeXml({ ...filter, category: "sem_servicos" }));
  assert.equal(child(empty, "lancamentos").children.length, 0);
  assert.equal(child(child(empty, "resumo"), "quantidade").text, "0");
  assert.equal(child(child(empty, "resumo"), "total").text, "0.00");
});

test("XML transforma marcação e entidades em texto e remove caracteres proibidos sem perder acentos ou emoji", async () => {
  const literal = 'João & Maria <script> "aspas" \'apóstrofo\' 🚗 <!DOCTYPE x [<!ENTITY segredo SYSTEM "file:///segredo">]> &segredo;';
  const invalid = "\u0000\u0001\u000B\u000C\uFFFE\uFFFF";
  await Transaction.create({
    date: paymentDate, clientName: literal + invalid, description: literal + "\tlinha\nseguinte",
    vehicleModel: literal, vehiclePlate: "ABC1D23", category: "wash", source: "manual", amount: 10, paymentMethod: "pix",
  });
  const source = await financeXml(filter);
  assert.match(source, /&amp;|&lt;|&gt;|&quot;|&apos;/);
  assert.doesNotMatch(source, /[\u0000\u0001\u000B\u000C\uFFFE\uFFFF]/);
  const entry = child(child(parsedXml(source), "lancamentos"), "lancamento");
  assert.equal(child(entry, "cliente").text, literal);
  assert.equal(child(entry, "servico").text, literal + "\tlinha\nseguinte");
  assert.equal(child(child(entry, "veiculo"), "modelo").text, literal);
  assert.equal(entry.children.filter((node) => node.name === "script").length, 0);
  // UTF-16 surrogates alone are invalid XML; query metadata preserves the
  // original input string, independent of MongoDB's UTF-8 normalization.
  const malformed = parsedXml(await financeXml({ ...filter, category: "Categoria\uD800X\uDC00" }));
  assert.equal(child(child(child(malformed, "metadados"), "filtros"), "categoria").text, "CategoriaX");
});

test("XML soma centavos sem acumular erro de ponto flutuante", async () => {
  await Transaction.create([0.1, 0.2].map((amount) => ({
    date: paymentDate, description: "Centavos", category: "wash", source: "manual", amount, paymentMethod: "pix",
  })));
  const root = parsedXml(await financeXml(filter));
  assert.equal(child(child(root, "resumo"), "total").text, "0.30");
  assert.deepEqual(child(root, "lancamentos").children.map((entry) => child(entry, "valor").text).sort(), ["0.10", "0.20"]);
});

test("XML rejeita exportação com mais de 20 mil lançamentos em vez de truncar dados", async () => {
  await Transaction.collection.insertMany(Array.from({ length: 20001 }, () => ({
    date: paymentDate, description: "Volume", category: "wash", source: "manual", amount: 1, paymentMethod: "pix",
  })));
  await assert.rejects(financeXml(filter), (error: { status?: number; message?: string }) =>
    error.status === 413 && /20 mil lançamentos/.test(error.message || ""));
});

test("Excel conserva colunas financeiras e acrescenta veículo, cliente e datas reais em Fortaleza", async () => {
  const { appointment } = await guestReceipt();
  // Receipts outside the paid-date interval or filters must remain excluded,
  // even if their appointments arrived inside the selected interval.
  await Transaction.create([
    { date: new Date("2026-10-02T03:00:00Z"), description: "Dia seguinte", category: "wash", source: "manual", amount: 99, paymentMethod: "pix" },
    { date: paymentDate, description: "Cartão", category: "wash", source: "manual", amount: 99, paymentMethod: "card" },
    { date: paymentDate, description: "Extra", category: "extra", source: "manual", amount: 99, paymentMethod: "pix" },
  ]);
  const sheet = await exportedSheet();
  assert.equal(sheet.rowCount, 2);
  assert.deepEqual(Array.from(sheet.getRow(1).values as ExcelJS.CellValue[]), [undefined,
    "Data (America/Fortaleza)", "Cliente", "Serviço", "Categoria", "Pagamento",
    "Valor", "Origem", "Placa", "Veículo", "Agendamento",
    "Agendado para (America/Fortaleza)", "Entrada do veículo (America/Fortaleza)",
    "Início do serviço (America/Fortaleza)", "Serviço concluído (America/Fortaleza)",
    "Pagamento registrado em (America/Fortaleza)", "Saída do veículo (America/Fortaleza)", "Status atual",
    "Lançamento original do ajuste", "Tipo de ajuste", "Motivo do ajuste",
  ]);
  assert.equal(sheet.getCell("B2").value, "Cliente do recibo");
  assert.equal(sheet.getCell("C2").value, "Lavagem do recibo");
  assert.equal(sheet.getCell("E2").value, "pix");
  assert.equal(sheet.getCell("F2").value, 50.25);
  assert.equal(sheet.getCell("H2").value, "ABC1D23");
  assert.equal(sheet.getCell("I2").value, "Onix do recibo");
  assert.equal(sheet.getCell("J2").value, String(appointment._id));
  assert.equal(sheet.getCell("K2").value, "03/10/2026, 10:00:00");
  assert.equal(sheet.getCell("L2").value, "01/10/2026, 11:00:00");
  assert.equal(sheet.getCell("M2").value, "01/10/2026, 11:10:00");
  assert.equal(sheet.getCell("N2").value, "01/10/2026, 11:40:00");
  assert.equal(sheet.getCell("O2").value, "01/10/2026, 22:30:00");
  assert.equal(sheet.getCell("P2").value, "Não entregue");
  assert.equal(sheet.getCell("Q2").value, statusLabels.completed);
  assert.match(String(sheet.getCell("A2").value), /^01\/10\/2026/);
  const monthly = await exportedSheet({ ...periodBounds("month", "2026-10-01"), category: "wash", paymentMethod: "pix" });
  assert.equal(monthly.rowCount, 3);
});

test("Excel consulta a entrega atual realizada depois da criação do recibo", async () => {
  const { appointment, receipt } = await guestReceipt();
  assert.equal((await exportedSheet()).getCell("P2").value, "Não entregue");
  await Appointment.updateOne({ _id: appointment._id }, {
    $set: { status: "delivered", deliveredAt: new Date("2026-10-02T02:00:00Z") },
  });
  const sheet = await exportedSheet();
  assert.equal(sheet.getCell("P2").value, "01/10/2026, 23:00:00");
  assert.equal(sheet.getCell("Q2").value, statusLabels.delivered);
  assert.equal(sheet.getCell("B2").value, "Cliente do recibo");
  assert.equal(sheet.getCell("F2").value, 50.25);
  assert.equal(+(await Transaction.findById(receipt._id)).date, +paymentDate);
});

test("Recibos antigos recuperam cliente cadastrado ou avulso e não inventam datas ausentes", async () => {
  const user = await User.create({ clerkId: "finance-legacy", name: "Maria Cliente" });
  const registered = await Appointment.create({
    userId: user._id,
    vehicle: { model: "Uno", plate: "REG1A23", type: "small" },
    serviceName: "Lavagem antiga", scheduledAt: new Date("2026-09-30T12:00:00Z"), status: "delivered",
  });
  await Transaction.create({
    appointmentId: registered._id, userId: user._id, date: paymentDate,
    description: "Descrição antiga", category: "wash", source: "appointment", amount: 30, paymentMethod: "pix",
  });
  const { appointment: guest } = await guestReceipt(false);
  const sheet = await exportedSheet();
  const rows = [sheet.getRow(2), sheet.getRow(3)];
  const registeredRow = rows.find((row) => row.getCell(10).value === String(registered._id))!;
  assert.equal(registeredRow.getCell(2).value, "Maria Cliente");
  assert.equal(registeredRow.getCell(3).value, "Lavagem antiga");
  assert.equal(registeredRow.getCell(8).value, "REG1A23");
  assert.equal(registeredRow.getCell(9).value, "Uno");
  for (const column of [12, 13, 14, 15, 16]) assert.equal(registeredRow.getCell(column).value, "Não registrado");
  const guestRow = rows.find((row) => row.getCell(10).value === String(guest._id))!;
  assert.equal(guestRow.getCell(2).value, "Nome alterado no atendimento");
  assert.equal(guestRow.getCell(8).value, "NEW2A34");
});

test("Lançamentos manuais e recibos sem atendimento continuam exportáveis com campos ausentes explícitos", async () => {
  const user = await User.create({ clerkId: "finance-manual", name: "José Cliente" });
  await Transaction.create([
    { userId: user._id, date: paymentDate, description: "Polimento manual", category: "wash", source: "manual", amount: 150, paymentMethod: "pix" },
    { appointmentId: new mongoose.Types.ObjectId(), clientName: "Cliente preservado", vehiclePlate: "OLD1A23", vehicleModel: "Celta", date: new Date(+paymentDate + 1000), description: "Recibo histórico", category: "wash", source: "appointment", amount: 35, paymentMethod: "pix" },
  ]);
  const sheet = await exportedSheet();
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("B2").value, "José Cliente");
  assert.equal(sheet.getCell("F2").value, 150);
  assert.equal(sheet.getCell("G2").value, "manual");
  assert.equal(sheet.getCell("B3").value, "Cliente preservado");
  assert.equal(sheet.getCell("H3").value, "OLD1A23");
  for (const row of [2, 3]) for (const column of [11, 12, 13, 14, 15, 16, 17])
    assert.equal(sheet.getRow(row).getCell(column).value, "—");
});

test("Nomes e descrições começando com fórmula permanecem texto literal no arquivo Excel", async () => {
  const text = '=HYPERLINK("https://example.invalid","nome")';
  const appointment = await Appointment.create({
    guestName: text, vehicle: { model: "@SUM(1+1)", plate: "=1+1", type: "small" },
    serviceName: "+SUM(1+1)", scheduledAt: paymentDate, status: "completed",
  });
  await Transaction.create({
    appointmentId: appointment._id, date: paymentDate, description: "-SUM(1+1)", category: "wash",
    source: "appointment", amount: 10, paymentMethod: "pix",
  });
  const sheet = await exportedSheet();
  for (const column of [2, 3, 8, 9]) assert.equal(sheet.getRow(2).getCell(column).type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("B2").value, text);
  assert.equal(sheet.getCell("C2").value, "+SUM(1+1)");
  assert.equal(sheet.getCell("H2").value, "=1+1");
  assert.equal(sheet.getCell("I2").value, "@SUM(1+1)");
});

test("Agrupamento financeiro trata chaves de protótipo como descrições literais", async () => {
  const descriptions = ["__proto__", "constructor", "toString"];
  await Transaction.create(descriptions.flatMap(description => [1.25, 2.5].map(amount => ({
    date: paymentDate, description, category: "wash", source: "manual", amount, paymentMethod: "pix",
  }))));
  const summary = await financeSummary(filter);
  assert.equal(summary.total, 11.25);
  assert.equal(summary.count, 6);
  const byName = (a: {name: string}, b: {name: string}) => a.name.localeCompare(b.name);
  assert.deepEqual(summary.byService.sort(byName), descriptions.map(name => ({ name, value: 3.75 })).sort(byName));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await financeWorkbook(filter) as never);
  const sheet = book.getWorksheet("Por serviço")!;
  assert.equal(sheet.rowCount, 4);
  const rows = [2, 3, 4].map(index => ({name: String(sheet.getCell(`A${index}`).value), value: sheet.getCell(`B${index}`).value}));
  assert.deepEqual(rows.sort(byName), descriptions.map(name => ({name, value: 3.75})).sort(byName));
});

test("Estornos e correções somam deltas por data e preservam recibo original/referência nas exportações", async () => {
  const { appointment, receipt } = await guestReceipt();
  await Transaction.create({
    date: new Date(+paymentDate + 1000), description: "Correção de valor", category: "wash", source: "adjustment",
    correctionOf: receipt._id, action: "correct", reason: "Valor digitado incorretamente", amount: -20.25,
    paymentMethod: "pix", clientName: "Cliente do recibo", serviceName: "Lavagem do recibo",
  });
  await Transaction.create({
    date: paymentDate, description: "Cortesia", category: "wash", source: "manual", amount: 0, paymentMethod: "pix",
  });
  const summary = await financeSummary(filter);
  assert.equal(summary.total, 30); assert.equal(summary.count, 3);
  assert.equal(summary.paidCount, 1); assert.equal(summary.average, 30);
  assert.equal(summary.byService.find((entry) => entry.name === "Lavagem do recibo")?.value, 30);
  const original = await Transaction.findById(receipt._id).lean();
  assert.equal(original.amount, 50.25);
  const entries = child(parsedXml(await financeXml(filter)), "lancamentos").children;
  const correction = entries.find((entry) => child(entry, "origem").text === "adjustment")!;
  assert.equal(correction.attributes.agendamento_id, String(appointment._id));
  assert.equal(child(correction, "valor").text, "-20.25");
  assert.equal(child(child(correction, "ajuste"), "lancamento_original").text, String(receipt._id));
  assert.equal(child(child(correction, "ajuste"), "motivo").text, "Valor digitado incorretamente");
  const sheet = await exportedSheet();
  const row = Array.from({ length: sheet.rowCount - 1 }, (_, index) => sheet.getRow(index + 2))
    .find((candidate) => candidate.getCell(7).value === "adjustment")!;
  assert.equal(row.getCell(6).value, -20.25); assert.equal(row.getCell(18).value, String(receipt._id));
  assert.equal(row.getCell(19).value, "Correção");
});

test("Ticket exclui cortesias e originais totalmente estornados, inclusive ajustes em outro período", async () => {
  const { receipt } = await guestReceipt();
  await Transaction.create({ date: new Date("2026-10-02T13:00:00Z"), source: "adjustment", correctionOf: receipt._id,
    action: "refund", reason: "Estorno integral do cliente", amount: -50.25, category: "wash", paymentMethod: "pix" });
  const paidDay = await financeSummary(filter);
  assert.equal(paidDay.total, 50.25); assert.equal(paidDay.count, 1);
  assert.equal(paidDay.average, 0); assert.equal(paidDay.paidCount, 0);
  const refundDay = await financeSummary({ ...filter, ...periodBounds("day", "2026-10-02") });
  assert.equal(refundDay.total, -50.25); assert.equal(refundDay.count, 1); assert.equal(refundDay.average, 0);
});

const serviceFilter: ServiceFilter = { ...periodBounds("day", "2026-10-01"), criterion: "ready", category: "wash" };
async function performedService(values: Record<string, unknown> = {}) {
  return Appointment.create({ guestName: "Cliente sem conta", guestPhone: "85999999999", notes: "NOTA_INTERNA",
    trackingToken: "SEGREDO_TOKEN", trackingTokenHash: `HASH_${crypto.randomUUID()}`,
    vehicle: { model: "Onix", plate: "ABC1D23", type: "small" }, serviceName: "Lavagem Simples", serviceCategory: "wash",
    scheduledAt: new Date("2026-10-01T10:00:00Z"), arrivedAt: new Date("2026-10-01T12:00:00Z"),
    startedAt: new Date("2026-10-01T12:05:00Z"), readyAt: new Date("2026-10-01T13:00:00Z"),
    status: "ready", quotedPrice: 55, ...values });
}
test("Serviços realizados incluem prontos não pagos pela conclusão; pagamento posterior não muda o período operacional", async () => {
  const appointment = await performedService();
  await performedService({ serviceCategory: "extra", serviceName: "Fora da categoria" });
  await performedService({ readyAt: new Date("2026-10-02T03:00:00Z"), serviceName: "Outro dia" });
  let report = await servicesReport(serviceFilter);
  assert.equal(report.total, 1); assert.equal(report.summary.unpaid, 1);
  assert.equal(report.summary.totalReceived, 0); assert.equal(report.items[0].balance, 55);
  assert.equal(report.items[0].paymentStatus, "unpaid");
  assert.equal(report.items[0].clientName, "Cliente sem conta");
  const unpaidXml = await servicesXml(serviceFilter);
  assert.equal(child(child(child(parsedXml(unpaidXml), "servicos"), "servico"), "situacao_pagamento").attributes.codigo, "unpaid");
  assert.doesNotMatch(unpaidXml, /85999999999|NOTA_INTERNA|SEGREDO_TOKEN|HASH_/);
  await Transaction.create({ appointmentId: appointment._id, date: new Date("2026-10-02T13:00:00Z"),
    amount: 55, source: "appointment", category: "wash", description: "Lavagem Simples", paymentMethod: "pix",
    clientName: "Snapshot do recibo", serviceName: "Lavagem paga", vehicleModel: "Onix original", vehiclePlate: "OLD1A23" });
  await Appointment.updateOne({ _id: appointment._id }, { $set: { status: "completed", finalPrice: 55, completedAt: new Date("2026-10-02T13:00:00Z") } });
  report = await servicesReport(serviceFilter);
  assert.equal(report.total, 1); assert.equal(report.summary.paid, 1);
  assert.equal(report.summary.totalReceived, 55); assert.equal(report.items[0].balance, 0);
  assert.equal(report.items[0].clientName, "Snapshot do recibo");
  assert.equal((await financeSummary(filter)).count, 0);
  assert.equal((await servicesReport({ ...serviceFilter, criterion: "delivered" })).total, 0);
});

test("Relatório de entrega usa deliveredAt; devolução sem serviço e cancelamento não viram serviços realizados", async () => {
  const appointment = await performedService({ status: "delivered", completedAt: paymentDate,
    deliveredAt: new Date("2026-10-02T13:00:00Z"), deletedAt: new Date("2026-10-03T13:00:00Z") });
  await performedService({ status: "cancelled" });
  // A returned vehicle that never became ready has no completion record.
  await Appointment.collection.insertOne({ vehicle: { model: "Uno", plate: "DEF2A34", type: "small" },
    serviceName: "Devolvido sem executar", serviceCategory: "wash", status: "returned", scheduledAt: paymentDate,
    returnedAt: paymentDate, quotedPrice: 30 });
  const complete = await servicesReport(serviceFilter);
  assert.equal(complete.total, 1); assert.equal(complete.items[0].deleted, true);
  assert.equal((await servicesReport({ ...serviceFilter, criterion: "delivered" })).total, 0);
  const delivered = await servicesReport({ ...serviceFilter, ...periodBounds("day", "2026-10-02"), criterion: "delivered" });
  assert.equal(delivered.total, 1); assert.equal(delivered.items[0]._id, String(appointment._id));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await servicesWorkbook(serviceFilter) as never);
  const sheet = book.getWorksheet("Serviços realizados")!;
  assert.equal(sheet.rowCount, 2); assert.equal(sheet.getCell("B2").value, "Cliente sem conta");
  assert.equal(sheet.getCell("H2").value, "Pagamento pendente"); assert.equal(sheet.getCell("T2").value, "Sim");
});

test("Serviços paginam a lista, resumem todo o período e exportam todas as páginas com saldo líquido após ajustes", async () => {
  const appointments = await Promise.all(Array.from({ length: 35 }, () => performedService()));
  const appointment = appointments[0];
  await Appointment.updateOne({ _id: appointment._id }, { $set: { status: "completed", finalPrice: 30 } });
  const receipt = await Transaction.create({ appointmentId: appointment._id, date: paymentDate, source: "appointment",
    description: "Lavagem Simples", category: "wash", amount: 55, paymentMethod: "pix" });
  await Transaction.create({ correctionOf: receipt._id, date: new Date("2026-10-04T13:00:00Z"), source: "adjustment",
    action: "correct", amount: -25, reason: "Corrigir valor cobrado", category: "wash", paymentMethod: "pix" });
  const page = await servicesReport(serviceFilter, 2);
  assert.equal(page.total, 35); assert.equal(page.pages, 2); assert.equal(page.items.length, 5);
  assert.equal(page.summary.paid, 1); assert.equal(page.summary.unpaid, 34); assert.equal(page.summary.totalReceived, 30);
  const xml = parsedXml(await servicesXml(serviceFilter));
  assert.equal(child(xml, "servicos").children.length, 35);
  assert.equal(child(child(xml, "resumo"), "valor_recebido_liquido").text, "30.00");
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await servicesWorkbook(serviceFilter) as never);
  assert.equal(book.getWorksheet("Serviços realizados")!.rowCount, 36);
});

test("Recebimento zero corrigido para positivo vira pago e participa do ticket; estorno posterior não vira cortesia", async () => {
  const appointment = await performedService({ status: "completed", finalPrice: 0 });
  const receipt = await Transaction.create({ appointmentId: appointment._id, date: paymentDate, source: "appointment",
    category: "wash", description: "Lavagem Simples", amount: 0, paymentMethod: "pix" });
  let report = await servicesReport(serviceFilter);
  assert.equal(report.items[0].paymentStatus, "courtesy");
  assert.equal((await financeSummary(filter)).paidCount, 0);
  await Transaction.create({ correctionOf: receipt._id, source: "adjustment", date: new Date(+paymentDate + 1000),
    category: "wash", paymentMethod: "pix", action: "correct", reason: "O pagamento tinha sido omitido", amount: 40 });
  await Appointment.updateOne({ _id: appointment._id }, { $set: { finalPrice: 40 } });
  report = await servicesReport(serviceFilter);
  assert.equal(report.items[0].paymentStatus, "paid"); assert.equal(report.summary.paid, 1);
  assert.equal(report.items[0].received, 40); assert.equal(report.items[0].balance, 0);
  const paid = await financeSummary(filter);
  assert.equal(paid.paidCount, 1); assert.equal(paid.average, 40); assert.equal(paid.total, 40);
  await Transaction.create({ correctionOf: receipt._id, source: "adjustment", date: new Date(+paymentDate + 2000),
    category: "wash", paymentMethod: "pix", action: "refund", reason: "O valor foi devolvido ao cliente", amount: -40 });
  await Appointment.updateOne({ _id: appointment._id }, { $set: { finalPrice: 0 } });
  report = await servicesReport(serviceFilter);
  assert.equal(report.items[0].paymentStatus, "refunded"); assert.equal(report.items[0].received, 0);
  assert.equal(report.items[0].balance, 0); assert.equal((await financeSummary(filter)).paidCount, 0);
});

test("Período anterior com estornos líquidos negativos não gera percentual de crescimento invertido", async () => {
  await Transaction.create([
    { date: new Date("2026-09-30T15:00:00Z"), category: "wash", paymentMethod: "pix", source: "adjustment",
      correctionOf: new mongoose.Types.ObjectId(), action: "refund", amount: -50, description: "Estorno anterior" },
    { date: paymentDate, category: "wash", paymentMethod: "pix", source: "manual", amount: 100, description: "Recebimento atual" },
  ]);
  const summary = await financeSummary(filter);
  assert.equal(summary.total, 100); assert.equal(summary.previousTotal, -50); assert.equal(summary.comparison, null);
});

test("Excel completo reúne faturamento líquido e todos os veículos sem transformar orçamento ou cancelamento em receita", async () => {
  const appointments = await Appointment.create(appointmentStatuses.map((status, index) => ({
    guestName: index === 0 ? "=2+2" : `Cliente ${status}`, guestPhone: "5585999998888",
    vehicle: { model: "Modelo completo", plate: `CAR${String(index).padStart(4, "0")}`, type: "small" },
    serviceName: "Lavagem completa", serviceCategory: "wash", scheduledAt: new Date("2026-10-01T14:00:00Z"),
    quotedPrice: 50, status, ...(status === "completed" ? { finalPrice: 60 } : {}),
    notes: "NOTA-PRIVADA-NAO-EXPORTAR", trackingToken: "TOKEN-PRIVADO-NAO-EXPORTAR",
  })));
  const paid = appointments.find((item: { status: string }) => item.status === "completed")!;
  const receipt = await Transaction.create({ appointmentId: paid._id, date: paymentDate, amount: 100,
    source: "appointment", category: "wash", description: "Pagamento completo", paymentMethod: "pix" });
  await Transaction.create([{ date: paymentDate, amount: -40, source: "adjustment", correctionOf: receipt._id,
    category: "wash", description: "Correção completa", paymentMethod: "pix", action: "correct", reason: "Corrigir o valor cobrado" },
    { date: paymentDate, amount: 25, source: "manual", category: "wash", description: "Venda avulsa", paymentMethod: "pix" }]);
  await Appointment.insertMany(Array.from({ length: 205 }, (_, index) => ({
    guestName: `Outro veículo ${index}`, vehicle: { model: "Outro modelo", plate: `OTH${String(index).padStart(4, "0")}`, type: "small" },
    serviceName: "Serviço ainda não pago", serviceCategory: "wash", status: "confirmed", quotedPrice: 50,
    scheduledAt: new Date("2026-10-01T14:00:00Z"),
  })));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await completeWorkbook(filter) as never);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ["Resumo", "Entradas", "Por serviço", "Resumo de veículos", "Veículos e serviços"]);
  assert.equal(book.getWorksheet("Resumo")!.getCell("B2").value, 85);
  assert.equal(book.getWorksheet("Entradas")!.rowCount, 4);
  const cars = book.getWorksheet("Veículos e serviços")!;
  assert.equal(cars.rowCount, 216); // All pages, including pending and unpaid cars.
  for (const appointment of appointments) {
    const row = cars.getRows(2, 215)!.find(row => row.getCell(1).value === String(appointment._id))!;
    assert.ok(row, appointment.status);
    assert.equal(row.getCell(7).value, statusLabels[appointment.status]);
    if (["cancelled", "rejected", "returned"].includes(appointment.status)) {
      assert.equal(row.getCell(8).value, "Sem cobrança registrada"); assert.equal(row.getCell(12).value, 0);
    }
    if (appointment.status === "completed") { assert.equal(row.getCell(11).value, 60); assert.equal(row.getCell(12).value, 0); }
    if (appointment.status === "pending") { assert.equal(row.getCell(2).value, "=2+2"); assert.equal(row.getCell(2).type, ExcelJS.ValueType.String); }
  }
  const values = JSON.stringify(book.worksheets.map(sheet => sheet.getSheetValues()));
  for (const privateValue of ["NOTA-PRIVADA-NAO-EXPORTAR", "TOKEN-PRIVADO-NAO-EXPORTAR", "5585999998888"]) assert.equal(values.includes(privateValue), false);
});

test("Excel completo separa período financeiro da entrada, conclusão e entrega ou devolução dos veículos", async () => {
  const base = { guestName: "Cliente com datas diferentes", vehicle: { model: "Modelo de datas", plate: "DAT1A23", type: "small" },
    serviceName: "Serviço de datas", serviceCategory: "wash", quotedPrice: 80, scheduledAt: new Date("2026-09-30T14:00:00Z"),
    arrivedAt: new Date("2026-10-01T14:00:00Z"), readyAt: new Date("2026-10-02T14:00:00Z") };
  const delivered = await Appointment.create({ ...base, status: "delivered", finalPrice: 80, deliveredAt: new Date("2026-10-03T14:00:00Z") });
  const returned = await Appointment.create({ ...base, status: "returned", readyAt: undefined, returnedAt: new Date("2026-10-03T15:00:00Z") });
  await Transaction.create({ appointmentId: delivered._id, date: paymentDate, source: "appointment", amount: 80, category: "wash", paymentMethod: "pix", description: "Receita de datas" });
  for (const [criterion, date, ids] of [
    ["scheduled", "2026-10-01", []], ["arrived", "2026-10-01", [delivered._id, returned._id]],
    ["ready", "2026-10-02", [delivered._id]], ["delivered", "2026-10-03", [delivered._id, returned._id]],
  ] as const) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await completeWorkbook({ ...filter, ...periodBounds("day", date) }, criterion) as never);
    const rows = book.getWorksheet("Veículos e serviços")!;
    assert.equal(rows.rowCount, ids.length + 1);
    for (const id of ids) assert.ok(JSON.stringify(rows.getSheetValues()).includes(String(id)));
    assert.equal(book.getWorksheet("Resumo")!.getCell("B2").value, date === "2026-10-01" ? 80 : 0);
  }
});
