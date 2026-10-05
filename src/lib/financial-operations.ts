import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Appointment, Audit, Coupon, Transaction, User, connectDB } from "./db";
import { clientSchema, objectId, transactionSchema } from "./validation";
import { assert, cents, expiryForReward, loyaltyStep } from "./domain";
import { runSubmission } from "./submissions";
import type mongoose from "mongoose";

export const manualCouponSchema = z.strictObject({ userId: objectId, vehicle: clientSchema.shape.vehicles.element,
  expiresAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(5).max(500), requestId: z.uuid().optional() });
export async function issueManualCoupon(input: unknown, actor: string) {
  const parsed = manualCouponSchema.parse(input);
  return runSubmission("coupon", actor, parsed.requestId, parsed, "Coupon", async session => {
    assert(+new Date(parsed.expiresAt) > Date.now(), "Validade deve ser futura");
    assert(await User.exists({ _id: parsed.userId }).session(session), "Cliente não encontrado", 404);
    const [coupon] = await Coupon.create([{ userId: parsed.userId, vehiclePlate: parsed.vehicle.plate,
      vehicleType: parsed.vehicle.type, issuedAt: new Date(), expiresAt: new Date(parsed.expiresAt), issueKey: `manual:${randomUUID()}` }], { session });
    await Audit.create([{ adminClerkId: actor, userId: parsed.userId, action: "manual_coupon", reason: parsed.reason }], { session });
    return coupon.toObject();
  });
}
export async function createManualTransaction(input: unknown, actor: string) {
  const parsed = transactionSchema.parse(input);
  return runSubmission("manual-transaction", actor, parsed.requestId, parsed, "Transaction", async session => {
    assert(+new Date(parsed.date) <= Date.now(), "Lançamento não pode ter data futura");
    const customer = parsed.userId ? await User.findById(parsed.userId).session(session) : null;
    assert(!parsed.userId || customer, "Cliente não encontrado", 404);
    const { requestId: _requestId, ...fields } = parsed;
    const [entry] = await Transaction.create([{ ...fields, date: new Date(parsed.date), source: "manual", createdBy: actor, clientName: customer?.name }], { session });
    await Audit.create([{ adminClerkId: actor, userId: parsed.userId, transactionId: entry._id, action: "manual_transaction", reason: parsed.description, after: parsed.amount }], { session });
    return entry.toObject();
  });
}

// Financial reversals remove one earned credit, never invalidate a coupon that
// another attendance already reserved or used. A remaining adjustment consumes
// the next earned credit rather than creating a fictitious new reward.
export async function creditPaidWash(user: any, appointment: any, session: mongoose.ClientSession, now: Date) {
  user.totalWashes += 1;
  if ((user.loyaltyDebt || 0) > 0) user.loyaltyDebt -= 1;
  else {
    const step = loyaltyStep(user.loyaltyCount, true);
    user.loyaltyCount = step.count;
    const baseKey = `appointment:${appointment._id}`;
    const priorReward = step.issue ? await Coupon.exists({ issueKey: baseKey }).session(session) : null;
    if (step.issue) await Coupon.create([{ userId: user._id, vehiclePlate: appointment.vehicle.plate,
      vehicleType: appointment.vehicle.type, issuedAt: now, expiresAt: expiryForReward(now),
      issueKey: priorReward ? `${baseKey}:${randomUUID()}` : baseKey }], { session });
  }
  await user.save({ session });
}
async function reversePaidWash(user: any, session: mongoose.ClientSession, now: Date) {
  user.totalWashes = Math.max(0, user.totalWashes - 1);
  if (user.loyaltyCount > 0) user.loyaltyCount -= 1;
  else {
    const reward = await Coupon.findOne({ userId: user._id, status: "available", expiresAt: { $gt: now }, reservedAppointmentId: { $exists: false }, issueKey: /^appointment:/ })
      .sort({ issuedAt: -1, _id: -1 }).session(session);
    if (reward) { reward.status = "revoked"; reward.revokedAt = now; await reward.save({ session }); user.loyaltyCount = 9; }
    else user.loyaltyDebt = (user.loyaltyDebt || 0) + 1;
  }
  await user.save({ session });
}
export const correctionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("refund"), reason: z.string().trim().min(5).max(500), requestId: z.uuid() }),
  z.strictObject({ action: z.literal("correct"), reason: z.string().trim().min(5).max(500), requestId: z.uuid(), correctedAmount: transactionSchema.shape.amount }),
]);
export async function correctTransaction(id: string, input: unknown, actor: string) {
  objectId.parse(id);
  const parsed = correctionSchema.parse(input);
  const adjustment = await runSubmission(`correction:${id}`, actor, parsed.requestId, parsed, "Transaction", async session => {
    const original = await Transaction.findById(id).session(session);
    assert(original && original.source !== "adjustment", "Recebimento original não encontrado", 404);
    await Transaction.updateOne({ _id: id }, { $inc: { correctionVersion: 1 } }, { session });
    const adjustments = await Transaction.find({ correctionOf: id }).session(session).lean();
    const previous = cents(original.amount) + adjustments.reduce((sum, entry) => sum + cents(entry.amount), 0);
    const target = parsed.action === "refund" ? 0 : cents(parsed.correctedAmount);
    assert(previous !== target, "O recebimento já possui este valor líquido.", 409);
    assert(previous >= 0, "Saldo do recebimento inválido.", 409);
    const now = new Date();
    const appointment = original.appointmentId ? await Appointment.findById(original.appointmentId).session(session) : null;
    assert(!appointment?.couponId, "Pagamentos de cortesia não podem ser alterados por correção financeira.", 409);
    if (appointment) {
      if (appointment.countsForLoyalty && appointment.userId) {
        const user = await User.findById(appointment.userId).session(session);
        if (user) {
          const credited = appointment.loyaltyFinancialPositive ?? (previous > 0);
          if (credited && target === 0) await reversePaidWash(user, session, now);
          else if (!credited && target > 0) await creditPaidWash(user, appointment, session, now);
        }
        appointment.loyaltyFinancialPositive = target > 0;
      }
      appointment.finalPrice = target / 100;
      await appointment.save({ session });
    }
    const [entry] = await Transaction.create([{ date: now, source: "adjustment", correctionOf: original._id,
      action: parsed.action, reason: parsed.reason, description: `${parsed.action === "refund" ? "Estorno" : "Correção"}: ${original.description}`,
      amount: (target - previous) / 100, category: original.category, paymentMethod: original.paymentMethod,
      userId: original.userId, clientName: original.clientName, vehiclePlate: original.vehiclePlate,
      vehicleModel: original.vehicleModel, serviceName: original.serviceName, createdBy: actor }], { session });
    await Audit.create([{ adminClerkId: actor, userId: original.userId, appointmentId: original.appointmentId,
      transactionId: original._id, action: parsed.action === "refund" ? "payment_refunded" : "payment_corrected",
      reason: parsed.reason, before: previous / 100, after: target / 100 }], { session });
    return entry.toObject();
  });
  const original = await Transaction.findById(id).lean();
  const adjustments = await Transaction.find({ correctionOf: id }).select("amount").lean();
  return { ...adjustment, netAmount: (cents(original.amount) + adjustments.reduce((sum, entry) => sum + cents(entry.amount), 0)) / 100 };
}
export async function transactionNets(items: any[]) {
  await connectDB();
  const originals = items.filter(item => item.source !== "adjustment");
  const adjustments = originals.length ? await Transaction.aggregate([{ $match: { correctionOf: { $in: originals.map(item => item._id) } } },
    { $group: { _id: "$correctionOf", cents: { $sum: { $round: [{ $multiply: ["$amount", 100] }, 0] } } } }]) : [];
  const byId = new Map(adjustments.map(item => [String(item._id), item.cents]));
  const appointmentIds = originals.flatMap(item => item.appointmentId ? [item.appointmentId] : []);
  const courtesies = appointmentIds.length ? await Appointment.find({ _id: { $in: appointmentIds }, couponId: { $exists: true } })
    .select("_id").lean() : [];
  const courtesyIds = new Set(courtesies.map(item => String(item._id)));
  return items.map(item => item.source === "adjustment" ? { ...item, canCorrect: false } : { ...item,
    netAmount: (cents(item.amount) + (byId.get(String(item._id)) || 0)) / 100, corrected: byId.has(String(item._id)),
    canCorrect: !courtesyIds.has(String(item.appointmentId)) });
}
