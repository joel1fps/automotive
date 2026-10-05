import ExcelJS from "exceljs";
import type { PipelineStage } from "mongoose";
import { formatInTimeZone } from "date-fns-tz";
import { Appointment, Transaction, User, connectDB } from "./db";
import { assert, cents, localDate, previousBounds } from "./domain";
import { statusLabels, TIME_ZONE } from "./catalog";
import { historyCriterionLabels, type HistoryCriterion } from "./history-criteria";
export type FinanceFilter = {
  from: Date;
  to: Date;
  category?: string;
  paymentMethod?: string;
  previous?: { from: Date; to: Date };
};
export function financeQuery(filter: FinanceFilter) {
  return {
    date: { $gte: filter.from, $lt: filter.to },
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.paymentMethod ? { paymentMethod: filter.paymentMethod } : {}),
  };
}
// Every correction is an immutable signed entry. Originals stay intact, while
// their current net amount is resolved across correction dates for the ticket.
async function receiptNetAmounts(ids: unknown[]) {
  if (!ids.length) return new Map<string, number>();
  const adjustments = await Transaction.find({ source: "adjustment", correctionOf: { $in: ids } })
    .select("correctionOf amount").lean();
  const changes = new Map<string, number>();
  for (const entry of adjustments) {
    const id = String(entry.correctionOf);
    changes.set(id, (changes.get(id) || 0) + cents(entry.amount));
  }
  return changes;
}
export async function financeSummary(filter: FinanceFilter) {
  await connectDB();
  const [entries, previous] = await Promise.all([
    Transaction.find(financeQuery(filter)).select("date amount description serviceName paymentMethod source").sort({ date: 1 }).lean(),
    Transaction.find(
      financeQuery({
        ...filter,
        ...(filter.previous || previousBounds(filter.from, filter.to)),
      }),
    ).select("amount").lean(),
  ]);
  const total = entries.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const previousTotal = previous.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const originals = entries.filter((entry) => entry.source !== "adjustment");
  const changes = await receiptNetAmounts(originals.map((entry) => entry._id));
  const paid = originals.map((entry) => Math.max(0, cents(entry.amount) + (changes.get(String(entry._id)) || 0)))
    .filter((value) => value > 0);
  // Descriptions are user supplied: names such as "__proto__" are ordinary
  // grouping keys and must never access Object.prototype properties.
  const byDay: Record<string, number> = Object.create(null);
  const byService: Record<string, number> = Object.create(null);
  const byPayment: Record<string, number> = Object.create(null);
  for (const e of entries) {
    const day = localDate(e.date);
    byDay[day] = (byDay[day] || 0) + cents(e.amount);
    const service = e.serviceName || e.description;
    byService[service] =
      (byService[service] || 0) + cents(e.amount);
    byPayment[e.paymentMethod] =
      (byPayment[e.paymentMethod] || 0) + cents(e.amount);
  }
  const chart = (r: Record<string, number>) =>
    Object.entries(r).map(([name, value]) => ({ name, value: value / 100 }));
  return {
    total,
    count: entries.length,
    paidCount: paid.length,
    average: paid.length ? paid.reduce((sum, value) => sum + value, 0) / 100 / paid.length : 0,
    previousTotal,
    comparison: previousTotal > 0 ? (total / previousTotal - 1) * 100 : null,
    byDay: chart(byDay),
    byService: chart(byService),
    byPayment: chart(byPayment),
  };
}
const operationalDate = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Fortaleza",
  dateStyle: "short",
  timeStyle: "medium",
});
function exportedDate(value: Date | undefined, missing = "Não registrado") {
  return value ? operationalDate.format(value) : missing;
}
async function financeExportEntries(filter: FinanceFilter) {
  await connectDB();
  const entries = await Transaction.find(financeQuery(filter))
    .select("date description category paymentMethod amount source appointmentId userId clientName vehiclePlate vehicleModel serviceName correctionOf action reason")
    .sort({ date: 1 })
    .limit(20001)
    .lean();
  assert(entries.length <= 20000, "A exportação tem mais de 20 mil lançamentos. Escolha um período menor.", 413);
  const correctionIds = [...new Set(entries.flatMap((entry) => entry.correctionOf ? [String(entry.correctionOf)] : []))];
  const originals = correctionIds.length ? await Transaction.find({ _id: { $in: correctionIds } })
    .select("appointmentId").lean() : [];
  const originalById = new Map(originals.map((entry) => [String(entry._id), entry]));
  const appointmentIdFor = (entry: typeof entries[number]) => entry.appointmentId ||
    (entry.correctionOf ? originalById.get(String(entry.correctionOf))?.appointmentId : undefined);
  // Financial snapshots remain the source of identity and value. Read operational
  // dates from the current appointment: delivery can happen after its receipt.
  const appointmentIds = [...new Set(entries.flatMap((entry) =>
    appointmentIdFor(entry) ? [String(appointmentIdFor(entry))] : [],
  ))];
  const appointments = appointmentIds.length
    ? await Appointment.find({ _id: { $in: appointmentIds } })
      .select("userId guestName vehicle serviceName scheduledAt arrivedAt startedAt readyAt completedAt deliveredAt status")
      .lean()
    : [];
  const appointmentById = new Map(appointments.map((appointment) =>
    [String(appointment._id), appointment],
  ));
  const clientIds = [...new Set(entries.flatMap((entry) => {
    if (entry.clientName) return [];
    const appointmentId = appointmentIdFor(entry);
    const appointment = appointmentId ? appointmentById.get(String(appointmentId)) : undefined;
    if (appointment?.guestName) return [];
    const id = appointment?.userId || entry.userId;
    return id ? [String(id)] : [];
  }))];
  const users = clientIds.length
    ? await User.find({ _id: { $in: clientIds } }).select("name").lean()
    : [];
  const clientById = new Map(users.map((user) => [String(user._id), user.name]));
  return entries.map((entry) => {
    const appointmentId = appointmentIdFor(entry);
    const appointment = appointmentId ? appointmentById.get(String(appointmentId)) : undefined;
    const clientId = appointment?.userId || entry.userId;
    return {
      id: String(entry._id),
      date: entry.date as Date,
      client: entry.clientName || appointment?.guestName ||
        (clientId ? clientById.get(String(clientId)) : undefined),
      service: entry.serviceName || appointment?.serviceName || entry.description,
      category: entry.category,
      payment: entry.paymentMethod,
      amount: entry.amount as number,
      source: entry.source,
      correctionOf: entry.correctionOf ? String(entry.correctionOf) : undefined,
      correctionAction: entry.action as string | undefined,
      correctionReason: entry.reason as string | undefined,
      plate: entry.vehiclePlate || appointment?.vehicle?.plate,
      vehicle: entry.vehicleModel || appointment?.vehicle?.model,
      appointmentId: appointmentId ? String(appointmentId) : undefined,
      hasAppointment: !!appointment,
      scheduledAt: appointment?.scheduledAt as Date | undefined,
      arrivedAt: appointment?.arrivedAt as Date | undefined,
      startedAt: appointment?.startedAt as Date | undefined,
      readyAt: appointment?.readyAt as Date | undefined,
      completedAt: appointment?.completedAt as Date | undefined,
      deliveredAt: appointment?.deliveredAt as Date | undefined,
      status: appointment?.status as keyof typeof statusLabels | undefined,
    };
  });
}

// Only XML 1.0 characters are kept. Values never become markup, attributes,
// document declarations, or entities, including legacy text stored in MongoDB.
function xmlText(value: unknown) {
  const valid = Array.from(value == null ? "" : String(value)).filter((character) => {
    const point = character.codePointAt(0)!;
    return point === 9 || point === 10 || point === 13 ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
  }).join("");
  return valid.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}
function xmlElement(name: string, value: unknown, attributes = "") {
  return value == null || value === ""
    ? `<${name}${attributes}/>`
    : `<${name}${attributes}>${xmlText(value)}</${name}>`;
}
function xmlDate(value: Date | undefined) {
  return value ? formatInTimeZone(value, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx") : undefined;
}

export async function financeXml(filter: FinanceFilter) {
  const entries = await financeExportEntries(filter);
  const amount = entries.reduce((sum, entry) => sum + cents(entry.amount), 0);
  const rows = entries.map((entry) => [
    `    <lancamento id="${xmlText(entry.id)}"${entry.appointmentId ? ` agendamento_id="${xmlText(entry.appointmentId)}"` : ""}>`,
    `      ${xmlElement("data_lancamento", xmlDate(entry.date))}`,
    `      ${xmlElement("cliente", entry.client)}`,
    `      <veiculo>${xmlElement("modelo", entry.vehicle)}${xmlElement("placa", entry.plate)}</veiculo>`,
    `      ${xmlElement("servico", entry.service)}`,
    `      ${xmlElement("categoria", entry.category)}`,
    `      ${xmlElement("forma_pagamento", entry.payment)}`,
    `      ${xmlElement("valor", (cents(entry.amount) / 100).toFixed(2), ' moeda="BRL"')}`,
    `      ${xmlElement("origem", entry.source)}`,
    ...(entry.correctionOf ? [
      `      <ajuste>${xmlElement("lancamento_original", entry.correctionOf)}${xmlElement("acao", entry.correctionAction)}${xmlElement("motivo", entry.correctionReason)}</ajuste>`,
    ] : []),
    `      ${xmlElement("status", entry.status ? statusLabels[entry.status] || entry.status : undefined, ` codigo="${xmlText(entry.status)}"`)}`,
    "      <datas>",
    `        ${xmlElement("agendamento", xmlDate(entry.scheduledAt))}`,
    `        ${xmlElement("entrada", xmlDate(entry.arrivedAt))}`,
    `        ${xmlElement("inicio_servico", xmlDate(entry.startedAt))}`,
    `        ${xmlElement("conclusao_servico", xmlDate(entry.readyAt))}`,
    `        ${xmlElement("pagamento", xmlDate(entry.completedAt))}`,
    `        ${xmlElement("saida", xmlDate(entry.deliveredAt))}`,
    "      </datas>",
    "    </lancamento>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<automotive versao="1.0">',
    "  <metadados>",
    `    ${xmlElement("gerado_em", xmlDate(new Date()))}`,
    `    ${xmlElement("fuso_horario", TIME_ZONE)}`,
    '    <periodo inicio_inclusivo="' + xmlText(xmlDate(filter.from)) + '" fim_exclusivo="' + xmlText(xmlDate(filter.to)) + '"/>',
    "    <criterio_periodo>data_pagamento_lancamento</criterio_periodo>",
    `    <filtros>${xmlElement("categoria", filter.category)}${xmlElement("forma_pagamento", filter.paymentMethod)}</filtros>`,
    "  </metadados>",
    `  <resumo><quantidade>${entries.length}</quantidade><total moeda="BRL">${(amount / 100).toFixed(2)}</total></resumo>`,
    "  <lancamentos>",
    ...rows,
    "  </lancamentos>",
    "</automotive>",
    "",
  ].join("\n");
}

// ExcelJS string cells are literal text; no user input is used as a formula.
async function financialBook(filter: FinanceFilter) {
  const entries = await financeExportEntries(filter);
  const summary = await financeSummary(filter);
  const book = new ExcelJS.Workbook();
  book.creator = "Automotive";
  book.created = new Date();
  const cover = book.addWorksheet("Resumo");
  cover.columns = [
    { header: "Indicador / Dia", key: "name", width: 36 },
    { header: "Valor", key: "value", width: 22 },
  ];
  cover.addRows([
    { name: "Faturamento total", value: summary.total },
    { name: "Número de lançamentos", value: summary.count },
    { name: "Ticket dos lançamentos pagos", value: summary.average },
    { name: "Período anterior", value: summary.previousTotal },
    ...summary.byDay,
  ]);
  const detail = book.addWorksheet("Entradas");
  detail.columns = [
    { header: "Data (America/Fortaleza)", key: "date", width: 24 },
    { header: "Cliente", key: "client", width: 28 },
    { header: "Serviço", key: "service", width: 45 },
    { header: "Categoria", key: "category", width: 20 },
    { header: "Pagamento", key: "payment", width: 18 },
    { header: "Valor", key: "amount", width: 20 },
    { header: "Origem", key: "source", width: 20 },
    { header: "Placa", key: "plate", width: 15 },
    { header: "Veículo", key: "vehicle", width: 25 },
    { header: "Agendamento", key: "appointment", width: 28 },
    { header: "Agendado para (America/Fortaleza)", key: "scheduledAt", width: 32 },
    { header: "Entrada do veículo (America/Fortaleza)", key: "arrivedAt", width: 36 },
    { header: "Início do serviço (America/Fortaleza)", key: "startedAt", width: 35 },
    { header: "Serviço concluído (America/Fortaleza)", key: "readyAt", width: 35 },
    { header: "Pagamento registrado em (America/Fortaleza)", key: "completedAt", width: 42 },
    { header: "Saída do veículo (America/Fortaleza)", key: "deliveredAt", width: 35 },
    { header: "Status atual", key: "status", width: 30 },
    { header: "Lançamento original do ajuste", key: "correctionOf", width: 30 },
    { header: "Tipo de ajuste", key: "correctionAction", width: 20 },
    { header: "Motivo do ajuste", key: "correctionReason", width: 48 },
  ];
  entries.forEach((e) => {
    const missingDate = e.hasAppointment ? "Não registrado" : "—";
    detail.addRow({
      date: e.date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }),
      client: e.client || "—",
      service: e.service,
      category: e.category,
      payment: e.payment,
      amount: e.amount,
      source: e.source,
      correctionOf: e.correctionOf || "—",
      correctionAction: e.correctionAction === "refund" ? "Estorno" : e.correctionAction === "correct" ? "Correção" : "—",
      correctionReason: e.correctionReason || "—",
      plate: e.plate || "—",
      vehicle: e.vehicle || "—",
      appointment: e.appointmentId ? String(e.appointmentId) : "—",
      scheduledAt: exportedDate(e.scheduledAt, missingDate),
      arrivedAt: exportedDate(e.arrivedAt, missingDate),
      startedAt: exportedDate(e.startedAt, missingDate),
      readyAt: exportedDate(e.readyAt, missingDate),
      completedAt: exportedDate(e.completedAt, missingDate),
      deliveredAt: exportedDate(e.deliveredAt,
        e.hasAppointment && e.status !== "delivered" ? "Não entregue" : missingDate),
      status: e.status ? statusLabels[e.status] || e.status : "—",
    });
  });
  const services = book.addWorksheet("Por serviço");
  services.columns = [
    { header: "Serviço", key: "name", width: 50 },
    { header: "Total", key: "value", width: 22 },
  ];
  services.addRows(summary.byService);
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
    sheet.getRow(1).height = 26;
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1D3E85" },
      };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
  }
  cover.getColumn("value").numFmt = '"R$" #,##0.00';
  cover.getCell("B3").numFmt = "0";
  detail.getColumn("amount").numFmt = '"R$" #,##0.00';
  services.getColumn("value").numFmt = '"R$" #,##0.00';
  return book;
}
export async function financeWorkbook(filter: FinanceFilter) {
  return (await financialBook(filter)).xlsx.writeBuffer();
}

export type ServiceFilter = {
  from: Date;
  to: Date;
  category?: string;
  criterion: "ready" | "delivered";
};
export type ServiceReportEntry = {
  _id: string;
  clientName: string;
  vehicleModel: string;
  vehiclePlate: string;
  serviceName: string;
  category: string;
  status: string;
  quotedPrice: number | null;
  finalPrice: number | null;
  value: number | null;
  received: number;
  balance: number | null;
  paymentStatus: "unpaid" | "paid" | "courtesy" | "refunded" | "not_due";
  deleted: boolean;
  scheduledAt: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  readyAt?: Date;
  completedAt?: Date;
  deliveredAt?: Date;
  returnedAt?: Date;
};

// Operational periods are selected from the appointment, so a ready vehicle
// appears even before payment. Read-only historical reports retain completed
// work that an administrator later removed from the active appointment lists.
type VehicleFilter = Omit<ServiceFilter, "criterion"> & { criterion: HistoryCriterion };
function servicePipeline(filter: ServiceFilter | VehicleFilter, allVehicles = false): PipelineStage[] {
  const field = { scheduled: "scheduledAt", arrived: "arrivedAt", ready: "readyAt", delivered: "deliveredAt" }[filter.criterion];
  return [
    { $match: {
      ...(allVehicles && filter.criterion === "delivered"
        ? { $or: [{ deliveredAt: { $gte: filter.from, $lt: filter.to } }, { returnedAt: { $gte: filter.from, $lt: filter.to } }] }
        : { [field]: { $gte: filter.from, $lt: filter.to } }),
      ...(!allVehicles && ["ready", "delivered"].includes(filter.criterion) ? { status: { $in: ["ready", "completed", "delivered", "returned"] } } : {}),
      ...(filter.category ? { serviceCategory: filter.category } : {}),
    } },
    { $lookup: { from: Transaction.collection.name, let: { appointment: "$_id" }, pipeline: [
      { $match: { $expr: { $eq: ["$appointmentId", "$$appointment"] }, source: { $ne: "adjustment" } } },
      { $project: { amount: 1, clientName: 1, vehicleModel: 1, vehiclePlate: 1, serviceName: 1 } },
    ], as: "receipts" } },
    { $lookup: { from: Transaction.collection.name, let: { originals: "$receipts._id" }, pipeline: [
      { $match: { source: "adjustment", $expr: { $in: ["$correctionOf", "$$originals"] } } },
      { $project: { amount: 1 } },
    ], as: "adjustments" } },
    { $lookup: { from: User.collection.name, let: { customer: "$userId" }, pipeline: [
      { $match: { $expr: { $eq: ["$_id", "$$customer"] } } }, { $project: { name: 1 } },
    ], as: "customer" } },
    { $set: {
      received: { $round: [{ $add: [{ $sum: "$receipts.amount" }, { $sum: "$adjustments.amount" }] }, 2] },
      originalReceived: { $sum: "$receipts.amount" },
      value: { $ifNull: ["$finalPrice", { $ifNull: ["$quotedPrice", null] }] },
      hasReceipt: { $gt: [{ $size: "$receipts" }, 0] },
    } },
    { $project: {
      _id: { $toString: "$_id" },
      clientName: { $ifNull: [{ $arrayElemAt: ["$receipts.clientName", 0] }, { $ifNull: ["$guestName", { $ifNull: [{ $arrayElemAt: ["$customer.name", 0] }, "Cliente"] }] }] },
      vehicleModel: { $ifNull: [{ $arrayElemAt: ["$receipts.vehicleModel", 0] }, "$vehicle.model"] },
      vehiclePlate: { $ifNull: [{ $arrayElemAt: ["$receipts.vehiclePlate", 0] }, "$vehicle.plate"] },
      serviceName: { $ifNull: [{ $arrayElemAt: ["$receipts.serviceName", 0] }, "$serviceName"] },
      category: "$serviceCategory", status: 1, received: 1, value: 1,
      quotedPrice: { $ifNull: ["$quotedPrice", null] }, finalPrice: { $ifNull: ["$finalPrice", null] },
      balance: { $cond: ["$hasReceipt", 0, { $cond: [{ $eq: ["$value", null] }, null, { $max: [0, "$value"] }] }] },
      paymentStatus: { $cond: [
        { $or: [{ $ne: [{ $ifNull: ["$couponId", null] }, null] }, { $and: ["$hasReceipt", { $eq: ["$originalReceived", 0] }, { $eq: ["$received", 0] }, { $eq: [{ $size: "$adjustments" }, 0] }] }] },
        "courtesy", { $cond: ["$hasReceipt", { $cond: [{ $gt: ["$received", 0] }, "paid", "refunded"] }, "unpaid"] },
      ] },
      deleted: { $ne: [{ $ifNull: ["$deletedAt", null] }, null] },
      scheduledAt: 1, arrivedAt: 1, startedAt: 1, readyAt: 1, completedAt: 1, deliveredAt: 1, returnedAt: 1,
    } },
  ];
}

const serviceSummaryStage = { $group: {
  _id: null,
  count: { $sum: 1 },
  paid: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
  unpaid: { $sum: { $cond: [{ $eq: ["$paymentStatus", "unpaid"] }, 1, 0] } },
  totalValue: { $sum: { $ifNull: ["$value", 0] } },
  totalReceived: { $sum: "$received" },
} };
function roundedServiceSummary(summary?: Record<string, number>) {
  return {
    count: summary?.count || 0, paid: summary?.paid || 0, unpaid: summary?.unpaid || 0,
    totalValue: cents(summary?.totalValue || 0) / 100,
    totalReceived: cents(summary?.totalReceived || 0) / 100,
  };
}

export async function servicesReport(filter: ServiceFilter, page = 1) {
  await connectDB();
  assert(Number.isInteger(page) && page >= 1 && page <= 10000, "Página inválida");
  const field = filter.criterion === "ready" ? "readyAt" : "deliveredAt";
  const [result] = await Appointment.aggregate([
    ...servicePipeline(filter),
    { $facet: {
      items: [{ $sort: { [field]: -1, _id: -1 } }, { $skip: (page - 1) * 30 }, { $limit: 30 }],
      summary: [serviceSummaryStage],
    } },
  ]);
  const summary = roundedServiceSummary(result?.summary?.[0]);
  return { items: (result?.items || []) as ServiceReportEntry[], total: summary.count,
    page, pages: Math.ceil(summary.count / 30), summary };
}

async function serviceExportEntries(filter: ServiceFilter | VehicleFilter, allVehicles = false) {
  await connectDB();
  const field = { scheduled: "scheduledAt", arrived: "arrivedAt", ready: "readyAt", delivered: "deliveredAt" }[filter.criterion];
  const entries = await Appointment.aggregate<ServiceReportEntry>([
    ...servicePipeline(filter, allVehicles),
    ...(allVehicles ? [{ $set: {
      balance: { $cond: [{ $and: [{ $in: ["$status", ["cancelled", "rejected", "returned"]] }, { $eq: ["$paymentStatus", "unpaid"] }] }, 0, "$balance"] },
      paymentStatus: { $cond: [{ $and: [{ $in: ["$status", ["cancelled", "rejected", "returned"]] }, { $eq: ["$paymentStatus", "unpaid"] }] }, "not_due", "$paymentStatus"] },
    } }] : []),
    { $set: { exportOrder: allVehicles && filter.criterion === "delivered" ? { $ifNull: ["$deliveredAt", "$returnedAt"] } : `$${field}` } },
    { $sort: { exportOrder: 1, _id: 1 } }, { $limit: 20001 },
  ]);
  assert(entries.length <= 20000, "A exportação tem mais de 20 mil serviços. Escolha um período menor.", 413);
  return entries;
}
function entriesSummary(entries: ServiceReportEntry[]) {
  return {
    count: entries.length,
    paid: entries.filter((entry) => entry.paymentStatus === "paid").length,
    unpaid: entries.filter((entry) => entry.paymentStatus === "unpaid").length,
    totalValue: entries.reduce((sum, entry) => sum + cents(entry.value || 0), 0) / 100,
    totalReceived: entries.reduce((sum, entry) => sum + cents(entry.received), 0) / 100,
  };
}
const servicePaymentLabels: Record<ServiceReportEntry["paymentStatus"], string> = {
  unpaid: "Pagamento pendente", paid: "Pago", courtesy: "Cortesia", refunded: "Estornado",
  not_due: "Sem cobrança registrada",
};
export async function servicesXml(filter: ServiceFilter) {
  const entries = await serviceExportEntries(filter);
  const summary = entriesSummary(entries);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>', '<automotive_servicos versao="1.0">',
    "  <metadados>", `    ${xmlElement("gerado_em", xmlDate(new Date()))}`,
    `    ${xmlElement("fuso_horario", TIME_ZONE)}`,
    `    <periodo inicio_inclusivo="${xmlText(xmlDate(filter.from))}" fim_exclusivo="${xmlText(xmlDate(filter.to))}"/>`,
    `    ${xmlElement("criterio_periodo", filter.criterion === "ready" ? "conclusao_servico" : "entrega_veiculo")}`,
    `    ${xmlElement("categoria", filter.category)}`, "  </metadados>",
    `  <resumo><quantidade>${summary.count}</quantidade><pagos>${summary.paid}</pagos><pagamento_pendente>${summary.unpaid}</pagamento_pendente><valor_servicos moeda="BRL">${summary.totalValue.toFixed(2)}</valor_servicos><valor_recebido_liquido moeda="BRL">${summary.totalReceived.toFixed(2)}</valor_recebido_liquido></resumo>`,
    "  <servicos>",
    ...entries.map((entry) => [
      `    <servico agendamento_id="${xmlText(entry._id)}">`,
      `      ${xmlElement("cliente", entry.clientName)}`,
      `      <veiculo>${xmlElement("modelo", entry.vehicleModel)}${xmlElement("placa", entry.vehiclePlate)}</veiculo>`,
      `      ${xmlElement("descricao", entry.serviceName)}${xmlElement("categoria", entry.category)}`,
      `      ${xmlElement("status", statusLabels[entry.status] || entry.status, ` codigo="${xmlText(entry.status)}"`)}`,
      `      ${xmlElement("situacao_pagamento", servicePaymentLabels[entry.paymentStatus], ` codigo="${xmlText(entry.paymentStatus)}"`)}`,
      `      ${xmlElement("valor_orcado", entry.quotedPrice == null ? undefined : entry.quotedPrice.toFixed(2), ' moeda="BRL"')}`,
      `      ${xmlElement("valor_final", entry.finalPrice == null ? undefined : entry.finalPrice.toFixed(2), ' moeda="BRL"')}`,
      `      ${xmlElement("valor_recebido_liquido", entry.received.toFixed(2), ' moeda="BRL"')}`,
      `      ${xmlElement("saldo", entry.balance == null ? undefined : entry.balance.toFixed(2), ' moeda="BRL"')}`,
      `      ${xmlElement("excluido_da_agenda", entry.deleted ? "sim" : "nao")}`,
      "      <datas>",
      ...(["scheduledAt", "arrivedAt", "startedAt", "readyAt", "completedAt", "deliveredAt", "returnedAt"] as const).map((field, index) =>
        `        ${xmlElement(["agendamento", "entrada", "inicio_servico", "conclusao_servico", "pagamento", "saida", "devolucao"][index], xmlDate(entry[field]))}`),
      "      </datas>", "    </servico>",
    ].join("\n")),
    "  </servicos>", "</automotive_servicos>", "",
  ].join("\n");
}
export async function servicesWorkbook(filter: ServiceFilter) {
  const book = new ExcelJS.Workbook();
  book.creator = "Automotive"; book.created = new Date();
  await addServiceSheets(book, filter);
  return book.xlsx.writeBuffer();
}
async function addServiceSheets(book: ExcelJS.Workbook, filter: ServiceFilter | VehicleFilter, allVehicles = false) {
  const entries = await serviceExportEntries(filter, allVehicles);
  const summary = entriesSummary(entries);
  const cover = book.addWorksheet(allVehicles ? "Resumo de veículos" : "Resumo de serviços");
  cover.columns = [{ header: "Indicador", key: "name", width: 42 }, { header: "Valor", key: "value", width: 32 }];
  cover.addRows([
    { name: "Critério do período", value: historyCriterionLabels[filter.criterion] },
    { name: allVehicles ? "Atendimentos no período" : "Serviços realizados", value: summary.count }, { name: "Serviços pagos", value: summary.paid },
    { name: "Serviços com pagamento pendente", value: summary.unpaid },
    { name: allVehicles ? "Valor de referência dos atendimentos (R$)" : "Valor dos serviços (R$)", value: summary.totalValue },
    { name: "Recebido líquido desses serviços (R$)", value: summary.totalReceived },
    { name: "Observação", value: "Recebimentos podem ter ocorrido em outro período. Valores previstos e orçamentos não são faturamento recebido. Orçamentos pendentes não entram no total de valores." },
  ]);
  cover.getCell("B6").numFmt = '"R$" #,##0.00'; cover.getCell("B7").numFmt = '"R$" #,##0.00';
  const detail = book.addWorksheet(allVehicles ? "Veículos e serviços" : "Serviços realizados");
  detail.columns = [
    { header: "Atendimento", key: "_id", width: 28 }, { header: "Cliente", key: "clientName", width: 30 },
    { header: "Serviço", key: "serviceName", width: 42 }, { header: "Categoria", key: "category", width: 20 },
    { header: "Modelo", key: "vehicleModel", width: 25 }, { header: "Placa", key: "vehiclePlate", width: 16 },
    { header: "Status operacional", key: "status", width: 30 }, { header: "Situação do pagamento", key: "paymentStatus", width: 26 },
    { header: "Valor orçado", key: "quotedPrice", width: 20 }, { header: "Valor final", key: "finalPrice", width: 20 },
    { header: "Recebido líquido", key: "received", width: 22 }, { header: "Saldo", key: "balance", width: 20 },
    { header: "Agendado para (Fortaleza)", key: "scheduledAt", width: 28 },
    { header: "Entrada (Fortaleza)", key: "arrivedAt", width: 28 },
    { header: "Início (Fortaleza)", key: "startedAt", width: 28 },
    { header: "Conclusão (Fortaleza)", key: "readyAt", width: 28 },
    { header: "Pagamento (Fortaleza)", key: "completedAt", width: 28 },
    { header: "Saída (Fortaleza)", key: "deliveredAt", width: 28 },
    { header: "Devolução (Fortaleza)", key: "returnedAt", width: 28 },
    { header: "Excluído da agenda", key: "deleted", width: 24 },
  ];
  entries.forEach((entry) => detail.addRow({ ...entry,
    status: statusLabels[entry.status] || entry.status, paymentStatus: servicePaymentLabels[entry.paymentStatus],
    quotedPrice: entry.quotedPrice ?? "Sob orçamento", finalPrice: entry.finalPrice ?? "Não registrado",
    balance: entry.balance ?? "Sob orçamento", deleted: entry.deleted ? "Sim" : "Não",
    ...Object.fromEntries((["scheduledAt", "arrivedAt", "startedAt", "readyAt", "completedAt", "deliveredAt", "returnedAt"] as const)
      .map((field) => [field, exportedDate(entry[field])])),
  }));
  for (const key of ["quotedPrice", "finalPrice", "received", "balance"]) detail.getColumn(key).numFmt = '"R$" #,##0.00';
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
    sheet.getRow(1).height = 26;
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D3E85" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
  }
}
export async function completeWorkbook(filter: FinanceFilter, criterion: HistoryCriterion = "scheduled") {
  assert(Object.hasOwn(historyCriterionLabels, criterion), "Critério do relatório completo inválido");
  const book = await financialBook(filter);
  const cover = book.getWorksheet("Resumo")!;
  cover.addRows([
    { name: "Período financeiro", value: "Data do pagamento, lançamento, correção ou estorno" },
    { name: "Período dos veículos", value: historyCriterionLabels[criterion] },
    { name: "Filtro de pagamento", value: filter.paymentMethod || "Todos" },
    { name: "Observação", value: "O filtro de pagamento aplica-se ao faturamento. A lista de veículos inclui atendimentos sem pagamento. Valores previstos não são somados ao faturamento." },
  ]);
  await addServiceSheets(book, { from: filter.from, to: filter.to, category: filter.category, criterion }, true);
  const activeTab = book.worksheets.findIndex(sheet => sheet.name === "Veículos e serviços");
  book.views = [{ x: 0, y: 0, width: 25000, height: 10000, firstSheet: 0, activeTab, visibility: "visible" }];
  return book.xlsx.writeBuffer();
}
