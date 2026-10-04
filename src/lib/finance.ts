import ExcelJS from "exceljs";
import { Transaction, connectDB } from "./db";
import { cents, localDate, previousBounds } from "./domain";
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
export async function financeSummary(filter: FinanceFilter) {
  await connectDB();
  const entries = await Transaction.find(financeQuery(filter))
    .sort({ date: 1 })
    .lean();
  const previous = await Transaction.find(
    financeQuery({
      ...filter,
      ...(filter.previous || previousBounds(filter.from, filter.to)),
    }),
  )
    .select("amount")
    .lean();
  const total = entries.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const previousTotal = previous.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const byDay: Record<string, number> = {};
  const byService: Record<string, number> = {};
  const byPayment: Record<string, number> = {};
  for (const e of entries) {
    const day = localDate(e.date);
    byDay[day] = (byDay[day] || 0) + cents(e.amount);
    byService[e.description] =
      (byService[e.description] || 0) + cents(e.amount);
    byPayment[e.paymentMethod] =
      (byPayment[e.paymentMethod] || 0) + cents(e.amount);
  }
  const chart = (r: Record<string, number>) =>
    Object.entries(r).map(([name, value]) => ({ name, value: value / 100 }));
  return {
    total,
    count: entries.length,
    average: entries.length ? total / entries.length : 0,
    previousTotal,
    comparison: previousTotal ? (total / previousTotal - 1) * 100 : null,
    byDay: chart(byDay),
    byService: chart(byService),
    byPayment: chart(byPayment),
  };
}
// ExcelJS string cells are literal text; no user input is used as a formula.
export async function financeWorkbook(filter: FinanceFilter) {
  await connectDB();
  const entries = await Transaction.find(financeQuery(filter))
    .sort({ date: 1 })
    .lean();
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
    { name: "Número de serviços", value: summary.count },
    { name: "Ticket médio", value: summary.average },
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
  ];
  entries.forEach((e) =>
    detail.addRow({
      date: e.date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }),
      client: e.clientName || "—",
      service: e.description,
      category: e.category,
      payment: e.paymentMethod,
      amount: e.amount,
      source: e.source,
    }),
  );
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
  return book.xlsx.writeBuffer();
}
