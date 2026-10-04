import { Appointment } from "./db";
import { periodBounds } from "./domain";

// Aggregate before pagination: every appointment in the local business day counts.
export async function controlSummary(date: string) {
  const { from, to } = periodBounds("day", date);
  const [summary] = await Appointment.aggregate([
    { $match: { scheduledAt: { $gte: from, $lt: to }, status: { $in: ["pending", "confirmed", "arrived", "in_progress", "ready", "completed", "delivered"] } } },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      confirmed: { $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] } },
      completed: { $sum: { $cond: [{ $in: ["$status", ["completed", "delivered"]] }, 1, 0] } },
      receivableCents: { $sum: { $cond: [
        { $and: [{ $in: ["$status", ["confirmed","arrived","in_progress","ready"]] }, { $eq: [{ $ifNull: ["$couponId", null] }, null] }] },
        { $round: [{ $multiply: [{ $ifNull: ["$quotedPrice", 0] }, 100] }, 0] }, 0,
      ] } },
    } },
    { $project: { _id: 0, total: 1, confirmed: 1, completed: 1, receivable: { $divide: ["$receivableCents", 100] } } },
  ]);
  const [onSite, entered, inProgress, ready] = await Promise.all([
    Appointment.countDocuments({ arrivedAt: {$exists:true}, deliveredAt: {$exists:false}, status: {$nin:["cancelled","rejected"]} }),
    Appointment.countDocuments({arrivedAt:{$gte:from,$lt:to}}),
    Appointment.countDocuments({status:"in_progress"}),
    Appointment.countDocuments({status:{$in:["ready","completed"]},arrivedAt:{$exists:true},deliveredAt:{$exists:false}}),
  ]);
  return {...(summary ?? {total:0,confirmed:0,completed:0,receivable:0}),onSite,entered,inProgress,ready};
}
