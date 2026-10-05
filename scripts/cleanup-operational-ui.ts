import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";
import { Appointment, Audit, Slot, Transaction, connectDB } from "../src/lib/db";
import { assertHomologationUri } from "../src/lib/operational-migration";
import { assert } from "../src/lib/domain";

// Only disposable guest records explicitly identified by this UI workflow.
async function main() {
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const marker = process.argv[2];
  assert(/^operational-ui:\d{8}:independent$/.test(marker || ""), "Marcador de teste obrigatório");
  assertHomologationUri(process.env.MONGODB_URI);
  await connectDB();
  try {
    const removed = await mongoose.connection.transaction(async session => {
      const appointments = await Appointment.find({ notes: marker,
        guestName: { $regex: /^SMOKE UI / }, userId: { $exists: false },
        "vehicle.plate": { $in: ["UIA1B23", "UIA2B23"] },
      }).session(session);
      const ids = appointments.map(appointment => appointment._id);
      for (const appointment of appointments) {
        assert(!appointment.couponId, "Este teste não deve possuir cupom");
        if (appointment.slotKey && !appointment.walkIn && !appointment.slotReleasedAt) {
          const result = await Slot.updateOne({ key: appointment.slotKey, used: { $gt: 0 } },
            { $inc: { used: -1 } }, { session });
          assert(result.modifiedCount === 1, "Reserva inconsistente: limpeza revertida");
        }
      }
      await Transaction.deleteMany({ appointmentId: { $in: ids } }, { session });
      await Audit.deleteMany({ appointmentId: { $in: ids } }, { session });
      const result = await Appointment.deleteMany({ _id: { $in: ids }, notes: marker }, { session });
      return result.deletedCount;
    });
    console.log(`PASS: ${removed} atendimento(s) de teste UI e suas receitas/auditorias removidos.`);
  } finally { await mongoose.disconnect(); }
}
void main().catch(() => { console.error("FAIL: limpeza UI não concluída; dados alheios ao marcador não foram selecionados."); process.exitCode = 1; });
