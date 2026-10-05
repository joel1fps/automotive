import { Appointment, User, connectDB } from "./db";
import { assert, periodBounds } from "./domain";
import { appointmentStatuses, physicalQueueStatuses, type AppointmentStatus } from "./appointment-state";
import { historyCriteria, type HistoryCriterion } from "./history-criteria";
import { z } from "zod";
export type { HistoryCriterion } from "./history-criteria";

// No date filter: vehicles remain in the physical queue until handed over.
export type QueueFilters = { search?: string; status?: AppointmentStatus };
export type QueuePeriod = { from: Date; to: Date; page?: number; criterion?: HistoryCriterion } & QueueFilters;
export const queueFiltersSchema = z.strictObject({
  search: z.string().trim().max(100, "Busque com até 100 caracteres.").optional(),
  status: z.enum(appointmentStatuses).optional(),
});
const queuePageSize = 100;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function searchExpressions(search: string) {
  const literal = new RegExp(escapeRegex(search), "i");
  const normalizedPlate = search.replace(/[\s-]/g, "");
  const plate = /^[a-z\d]+$/i.test(normalizedPlate)
    ? new RegExp([...normalizedPlate].map(escapeRegex).join("[\\s-]*"), "i") : literal;
  return { literal, plate };
}
async function queueFilterMatch(filters: QueueFilters) {
  const search = filters.search;
  if (!search) return filters.status ? { status: filters.status } : {};
  const { literal, plate } = searchExpressions(search);
  const users = await User.find({ name: literal }).select("_id").lean();
  return { ...(filters.status ? { status: filters.status } : {}),
    $or: [{ "vehicle.plate": plate }, { guestName: literal }, { userId: { $in: users.map(user => user._id) } }],
  };
}
function filteredMatch(base: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.keys(filters).length ? { $and: [base, filters] } : base;
}
function historyMatch(from: Date, to: Date, criterion: HistoryCriterion) {
  assert(historyCriteria.includes(criterion), "Critério de data inválido");
  const range = { $gte: from, $lt: to };
  return {
    deletedAt: { $exists: false },
    ...(criterion === "delivered"
      ? { $or: [{ deliveredAt: range }, { returnedAt: range }] }
      : { [{ scheduled: "scheduledAt", arrived: "arrivedAt", ready: "readyAt" }[criterion]]: range }),
  };
}
function historyOrder(criterion: HistoryCriterion) {
  return criterion === "delivered" ? { $ifNull: ["$deliveredAt", "$returnedAt"] }
    : `$${{ scheduled: "scheduledAt", arrived: "arrivedAt", ready: "readyAt" }[criterion]}`;
}
export async function operationalQueue(period?: QueuePeriod, inputFilters: QueueFilters = {}) {
  await connectDB();
  const filters = queueFiltersSchema.parse({ search: inputFilters.search ?? period?.search, status: inputFilters.status ?? period?.status });
  if (period) {
    assert(Number.isFinite(+period.from) && Number.isFinite(+period.to) && period.from < period.to,
      "Período inválido");
    const page = period.page ?? 1;
    assert(Number.isInteger(page) && page >= 1 && page <= 100000, "Página inválida");
    const criterion = period.criterion ?? "scheduled";
    const query = filteredMatch(historyMatch(period.from, period.to, criterion), await queueFilterMatch(filters));
    const [rows, grouped] = await Promise.all([
      Appointment.aggregate([
        { $match: query },
        { $set: { queueOrder: criterion === "scheduled" ? { $cond: [
          { $in: ["$status", physicalQueueStatuses] },
          { $ifNull: ["$arrivedAt", { $ifNull: ["$startedAt", "$scheduledAt"] }] },
          "$scheduledAt",
        ] } : historyOrder(criterion) } },
        { $sort: { queueOrder: 1, _id: 1 } },
        { $skip: (page - 1) * queuePageSize },
        { $limit: queuePageSize },
        // Aggregation bypasses schema select:false; allow only the operator DTO.
        { $project: { userId: 1, guestName: 1, guestPhone: 1, vehicle: 1, serviceName: 1,
          scheduledAt: 1, status: 1, quotedPrice: 1, finalPrice: 1, couponId: 1, notes: 1,
          rejectionReason: 1, walkIn: 1, flexibleSchedule: 1, arrivedAt: 1, startedAt: 1, readyAt: 1,
          completedAt: 1, deliveredAt: 1, returnedAt: 1, returnReason: 1, estimatedCompletionAt: 1, createdAt: 1 } },
      ]),
      Appointment.aggregate([{ $match: query }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    await Appointment.populate(rows, { path: "userId", select: "name email phone" });
    const counts: Record<string, number> = Object.create(null);
    for (const group of grouped) counts[group._id] = group.count;
    const total = grouped.reduce((sum, group) => sum + group.count, 0);
    const items = rows.map(item => ({ ...item,
      clientName: item.userId?.name || item.guestName || "Cliente",
      clientPhone: item.userId?.phone || item.guestPhone || "",
    }));
    return { items, total, page, pages: Math.ceil(total / queuePageSize), counts };
  }
  const appointments = await Appointment.find({ deletedAt: { $exists: false }, status: { $in: physicalQueueStatuses } })
    .populate("userId", "name email phone")
    .sort({ arrivedAt: 1, _id: 1 }).lean();
  const arrival = (item: Record<string, any>) => +(item.arrivedAt || item.startedAt || item.readyAt || item.completedAt || item.createdAt || item.scheduledAt);
  appointments.sort((a, b) => arrival(a) - arrival(b) || String(a._id).localeCompare(String(b._id)));
  let waitingPosition = 0;
  const search = filters.search ? searchExpressions(filters.search) : null;
  const items = appointments.map(item => ({...item,
    clientName: item.userId?.name || item.guestName || "Cliente",
    clientPhone: item.userId?.phone || item.guestPhone || "",
    ...(item.status === "arrived" ? { queuePosition: ++waitingPosition } : {}),
  })).filter(item => (!filters.status || item.status === filters.status) &&
    (!search || search.plate.test(item.vehicle.plate) || search.literal.test(item.guestName || "") || search.literal.test(item.userId?.name || "")));
  return {items, total: items.length};
}

// Aggregate before pagination: every appointment in the local business day counts.
export async function controlSummary(date: string, range: "day" | "week" | "month" = "day", customBounds?: { from: Date; to: Date }, criterion: HistoryCriterion = "scheduled", inputFilters: QueueFilters = {}) {
  await connectDB();
  const filters = await queueFilterMatch(queueFiltersSchema.parse(inputFilters));
  const { from, to } = customBounds || periodBounds(range, date);
  const query = filteredMatch(historyMatch(from, to, criterion), filters);
  const [summary] = await Appointment.aggregate([
    { $match: query },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      confirmed: { $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] } },
      completed: { $sum: { $cond: [{ $in: ["$status", ["completed", "delivered"]] }, 1, 0] } },
      returned: { $sum: { $cond: [{ $eq: ["$status", "returned"] }, 1, 0] } },
      receivableCents: { $sum: { $cond: [
        { $and: [{ $in: ["$status", ["confirmed","arrived","in_progress","ready"]] }, { $eq: [{ $ifNull: ["$couponId", null] }, null] }] },
        { $round: [{ $multiply: [{ $ifNull: ["$quotedPrice", 0] }, 100] }, 0] }, 0,
      ] } },
    } },
    { $project: { _id: 0, total: 1, confirmed: 1, completed: 1, returned: 1, receivable: { $divide: ["$receivableCents", 100] } } },
  ]);
  const [onSite, entered, inProgress, ready, waiting, awaitingPayment, awaitingPickup, physicalReceivable, periodReceivable] = await Promise.all([
    Appointment.countDocuments(filteredMatch({ deletedAt: { $exists: false }, status: { $in: physicalQueueStatuses } }, filters)),
    Appointment.countDocuments(filteredMatch({deletedAt: { $exists: false },arrivedAt:{$gte:from,$lt:to}}, filters)),
    Appointment.countDocuments(filteredMatch({deletedAt: { $exists: false },status:"in_progress"}, filters)),
    Appointment.countDocuments(filteredMatch({deletedAt: { $exists: false },status:{$in:["ready","completed"]}}, filters)),
    Appointment.countDocuments(filteredMatch({deletedAt: { $exists: false },status:"arrived"}, filters)),
    Appointment.countDocuments(filteredMatch({deletedAt: { $exists: false },status:"ready"}, filters)),
    Appointment.countDocuments(filteredMatch({deletedAt: { $exists: false },status:"completed"}, filters)),
    Appointment.aggregate([
      {$match:filteredMatch({deletedAt: { $exists: false },status:{$in:["arrived","in_progress","ready"]},couponId:{$exists:false}}, filters)},
      {$group:{_id:null,cents:{$sum:{$round:[{$multiply:[{$ifNull:["$quotedPrice",0]},100]},0]}}}},
    ]),
    Appointment.aggregate([
      { $match: { ...query,
        status: { $in: ["confirmed", "arrived", "in_progress", "ready"] }, couponId: null } },
      { $group: { _id: null, cents: { $sum: { $round: [{ $multiply: [{ $ifNull: ["$quotedPrice", 0] }, 100] }, 0] } } } },
    ]),
  ]);
  return {...(summary ?? {total:0,confirmed:0,completed:0,returned:0,receivable:0}),
    onSite,entered,inProgress,ready,waiting,awaitingPayment,awaitingPickup,
    physicalReceivable:(physicalReceivable[0]?.cents || 0)/100,
    periodReceivable:(periodReceivable[0]?.cents || 0)/100};
}
