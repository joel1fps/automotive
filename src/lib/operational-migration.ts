import mongoose from "mongoose";
import { Appointment, Settings, Slot, Transaction, connectDB } from "./db";
import { appointmentSlot, assert } from "./domain";
import { getSettings } from "./business";

export const HOMOLOGATION_DATABASE = "automotive_homologacao";

export function assertHomologationUri(uri: string | undefined) {
  assert(uri, "Banco local não configurado", 503);
  const client = new mongoose.mongo.MongoClient(uri);
  assert(client.db().databaseName === HOMOLOGATION_DATABASE,
    "Esta operação exige a base automotive_homologacao", 403);
}

// Additive and repeatable: never removes data or changes the operational status.
export async function migrateOperationalData() {
  assertHomologationUri(process.env.MONGODB_URI);
  await connectDB();
  assert(mongoose.connection.name === HOMOLOGATION_DATABASE,
    "Base de homologação obrigatória", 403);
  await getSettings();
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  return mongoose.connection.transaction(async session => {
    // The same write serializes this repair with bookings/settings changes.
    const settings = await Settings.findOneAndUpdate({ key: "main" },
      { $inc: { __v: 1 } }, { session, returnDocument: "after" }).lean();
    assert(settings, "Configuração da agenda ausente", 409);
    const slots = await Slot.find().session(session).lean();
    const knownKeys = new Set<string>(slots.map(slot => String(slot.key)));
    const appointments = await Appointment.find({
      deletedAt: { $exists: false },
      flexibleSchedule: { $ne: true },
      status: { $in: ["pending", "confirmed", "arrived", "in_progress", "ready"] },
      walkIn: { $ne: true }, slotReleasedAt: { $exists: false },
    }).session(session).lean();
    const reservations = new Map<string, number>();
    let slotKeysAdded = 0;
    let unresolvedReservations = 0;
    for (const appointment of appointments) {
      let key = appointment.slotKey as string | undefined;
      if (!key) {
        const exact = appointment.scheduledAt.toISOString();
        const bucket = appointmentSlot(appointment.scheduledAt, settings)?.toISOString();
        key = knownKeys.has(exact) ? exact : bucket && knownKeys.has(bucket) ? bucket : undefined;
        if (key) {
          await Appointment.updateOne({ _id: appointment._id, slotKey: { $exists: false } },
            { $set: { slotKey: key } }, { session, timestamps: false });
          slotKeysAdded++;
        }
      }
      if (!key) { unresolvedReservations++; continue; }
      reservations.set(key, (reservations.get(key) || 0) + 1);
    }
    // Do not erase a counter whose legacy reservation could not be resolved.
    assert(unresolvedReservations === 0,
      "Há reservas antigas sem uma vaga identificável; a migração foi revertida para revisão", 409);
    let slotsReconciled = 0;
    for (const slot of slots) {
      const used = reservations.get(slot.key) || 0;
      if (slot.used !== used) {
        await Slot.updateOne({ _id: slot._id }, { $set: { used } }, { session });
        slotsReconciled++;
      }
      reservations.delete(slot.key);
    }
    for (const [key, used] of reservations) {
      await Slot.updateOne({ key }, { $set: { used }, $setOnInsert: { blocked: false } },
        { session, upsert: true });
      slotsReconciled++;
    }
    const release = await Appointment.updateMany({
      status: { $in: ["completed", "delivered", "cancelled", "rejected"] },
      flexibleSchedule: { $ne: true },
      walkIn: { $ne: true }, slotReleasedAt: { $exists: false },
    }, { $set: { slotReleasedAt: new Date() } }, { session, timestamps: false });
    let receiptsEnriched = 0;
    const receipts = await Transaction.find({ source: "appointment", appointmentId: { $exists: true } })
      .session(session).lean();
    for (const receipt of receipts) {
      const appointment = await Appointment.findById(receipt.appointmentId).session(session).lean();
      if (!appointment) continue;
      const additions: Record<string, string> = {};
      if (!receipt.vehiclePlate && appointment.vehicle?.plate) additions.vehiclePlate = appointment.vehicle.plate;
      if (!receipt.vehicleModel && appointment.vehicle?.model) additions.vehicleModel = appointment.vehicle.model;
      if (!receipt.serviceName && appointment.serviceName) additions.serviceName = appointment.serviceName;
      if (Object.keys(additions).length) {
        await Transaction.updateOne({ _id: receipt._id }, { $set: additions }, { session, timestamps: false });
        receiptsEnriched++;
      }
    }
    return { slotKeysAdded, slotsReconciled, releasesMarked: release.modifiedCount, receiptsEnriched };
  });
}
