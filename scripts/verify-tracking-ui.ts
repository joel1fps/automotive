import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { Appointment, Audit, Transaction, connectDB } from "../src/lib/db";
import { assertHomologationUri } from "../src/lib/operational-migration";
import { financeWorkbook } from "../src/lib/finance";
import { localDate, periodBounds } from "../src/lib/domain";

const marker = "tracking-ui:20261004:independent";
const fixture = { notes: marker, guestName: "TESTE ACOMPANHAMENTO", "vehicle.plate": "TRK1A23", walkIn: true,
  userId: { $exists: false }, couponId: { $exists: false } };

async function main() {
  const mode = process.argv[2];
  assert(mode === "verify" || mode === "cleanup", "Choose verify or cleanup");
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  assertHomologationUri(process.env.MONGODB_URI);
  await connectDB();
  assert.equal(mongoose.connection.name, "automotive_homologacao");
  try {
    const appointments = await Appointment.find(fixture).select("+trackingToken");
    assert.equal(appointments.length, 1, "Exactly one identified disposable appointment required");
    const appointment = appointments[0];
    if (mode === "cleanup") {
      await mongoose.connection.transaction(async session => {
        const owned = await Appointment.findOne({ ...fixture, _id: appointment._id }).session(session);
        assert(owned && !owned.slotKey, "Fixture must not own an agenda reservation");
        await Transaction.deleteMany({ appointmentId: owned._id }, { session });
        await Audit.deleteMany({ appointmentId: owned._id }, { session });
        const deleted = await Appointment.deleteOne({ ...fixture, _id: owned._id }, { session });
        assert.equal(deleted.deletedCount, 1);
      });
      assert.equal(await Appointment.countDocuments(fixture), 0);
      console.log("PASS: somente o atendimento identificado de acompanhamento e seus recibos/auditorias foram removidos.");
      return;
    }
    assert(appointment.trackingToken, "Active link required for anonymous verification");
    const response = await fetch(`http://localhost:3000/api/tracking/${appointment.trackingToken}`, { redirect: "error" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control") || "", /no-store/);
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    const dto = await response.json();
    assert.equal(dto.vehicle.plate, "TRK1A23");
    for (const field of ["_id", "userId", "guestName", "guestPhone", "notes", "finalPrice", "quotedPrice", "paymentMethod", "trackingToken", "trackingTokenHash"])
      assert.equal(field in dto, false, field);
    console.log("PASS: acompanhamento consultado por HTTP sem cookies ou login; apenas dados públicos do veículo.");
    assert.equal(appointment.status, "delivered");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await financeWorkbook(periodBounds("day", localDate(appointment.completedAt))) as never);
    const sheet = workbook.getWorksheet("Entradas")!;
    const headers = sheet.getRow(1).values;
    let ownRow: ExcelJS.Row | undefined;
    sheet.eachRow((row, index) => { if (index > 1 && row.getCell(10).text === String(appointment._id)) ownRow = row; });
    assert(ownRow, "Receipt missing in XLSX");
    assert.equal(ownRow.getCell(2).text, fixture.guestName);
    assert.equal(ownRow.getCell(8).text, "TRK1A23");
    assert.equal(ownRow.getCell(6).value, 12.34);
    assert.ok(ownRow.getCell(12).text && ownRow.getCell(16).text);
    assert.equal(await Transaction.countDocuments({ appointmentId: appointment._id }), 1);
    const folder = path.resolve("../evidencias/acompanhamento");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "smoke.json"), JSON.stringify({ checkedAt: new Date().toISOString(),
      publicWithoutLogin: true, privateFieldsAbsent: true, noStore: true,
      fixtureOnly: { plate: "TRK1A23", state: appointment.status }, export: { headers, row: ownRow.values } }, null, 2));
    console.log("PASS: Excel real contém cliente, valor, entrada, saída e estado entregue do atendimento descartável.");
  } finally { await mongoose.disconnect(); }
}
void main().catch(() => { console.error("FAIL: verificação de acompanhamento não concluída; informações sensíveis omitidas."); process.exitCode = 1; });
