import mongoose, { Schema } from "mongoose";
import { setServers } from "node:dns";
const objectId = Schema.Types.ObjectId;
const vehicle = {
  model: { type: String, required: true },
  plate: { type: String, required: true },
  type: { type: String, enum: ["small", "suv", "pickup", "moto"], required: true },
};
const schemas = {
  User: new Schema(
    {
      clerkId: { type: String, required: true, unique: true },
      name: String,
      email: String,
      phone: String,
      role: { type: String, enum: ["client", "admin"], default: "client" },
      loyaltyCount: { type: Number, default: 0, min: 0, max: 9 },
      totalWashes: { type: Number, default: 0 },
      loyaltyDebt: { type: Number, default: 0, min: 0 },
      vehicles: [new Schema(vehicle, { _id: false })],
      consentAt: Date,
    },
    { timestamps: true },
  ),
  Service: new Schema(
    {
      name: String,
      slug: { type: String, unique: true },
      category: { type: String, enum: ["wash", "extra"] },
      prices: { small: Number, suv: Number, pickup: Number, moto: Number },
      imageUrl: String,
      vehicleTypes: [String],
      startingPrice: Number,
      countsForLoyalty: Boolean,
      active: Boolean,
      description: String,
    },
    { timestamps: true },
  ),
  Appointment: new Schema(
    {
      userId: { type: objectId, ref: "User" },
      guestName: String,
      guestPhone: String,
      vehicle: new Schema(vehicle, { _id: false }),
      serviceId: { type: objectId, ref: "Service" },
      customDescription: String,
      serviceName: String,
      serviceCategory: String,
      countsForLoyalty: Boolean,
      scheduledAt: { type: Date, required: true },
      status: {
        type: String,
        enum: ["pending", "confirmed", "completed", "rejected", "cancelled", "arrived", "in_progress", "ready", "delivered", "returned"],
        default: "pending",
      },
      createdBy: String,
      couponId: { type: objectId, ref: "Coupon" },
      quotedPrice: Number,
      finalPrice: Number,
      paymentMethod: String,
      notes: String,
      rejectionReason: String,
      confirmedAt: Date,
      cancelledAt: Date,
      rejectedAt: Date,
      completedAt: Date,
      arrivedAt: Date,
      startedAt: Date,
      readyAt: Date,
      deliveredAt: Date,
      returnedAt: Date,
      returnReason: String,
      loyaltyFinancialPositive: Boolean,
      slotKey: String,
      walkIn: { type: Boolean, default: false },
      flexibleSchedule: { type: Boolean, default: false },
      slotReleasedAt: Date,
      estimatedCompletionAt: Date,
      trackingToken: { type: String, select: false },
      trackingTokenHash: { type: String, select: false },
      trackingGeneratedAt: Date,
      trackingRevokedAt: Date,
      deletedAt: Date,
      deletedBy: String,
      deletionReason: { type: String, select: false },
    },
    { timestamps: true },
  ),
  Coupon: new Schema({
    userId: { type: objectId, ref: "User", required: true },
    type: { type: String, default: "simple_wash_free" },
    status: {
      type: String,
      enum: ["available", "used", "expired", "revoked"],
      default: "available",
    },
    vehiclePlate: { type: String, required: true },
    vehicleType: String,
    issuedAt: Date,
    expiresAt: Date,
    usedAt: Date,
    usedInAppointmentId: objectId,
    reservedAppointmentId: objectId,
    revokedAt: Date,
    issueKey: { type: String, unique: true },
  }),
  Transaction: new Schema(
    {
      date: Date,
      description: String,
      category: String,
      source: { type: String, enum: ["appointment", "manual", "adjustment"] },
      appointmentId: { type: objectId, unique: true, sparse: true },
      userId: { type: objectId, ref: "User" },
      clientName: String,
      vehiclePlate: String,
      vehicleModel: String,
      serviceName: String,
      amount: { type: Number },
      correctionOf: { type: objectId, ref: "Transaction" },
      action: { type: String, enum: ["refund", "correct"] },
      reason: String,
      correctionVersion: { type: Number, default: 0 },
      paymentMethod: String,
      createdBy: String,
      notes: String,
    },
    { timestamps: true },
  ),
  Settings: new Schema({
    key: { type: String, unique: true },
    loyaltyTarget: Number,
    couponValidityDays: Number,
    couponSameVehicleType: Boolean,
    slotDuration: Number,
    capacityPerSlot: Number,
    openingDays: [Number],
    openTime: String,
    closeTime: String,
    provisionalHours: Boolean,
  }),
  Slot: new Schema({
    key: { type: String, unique: true },
    used: { type: Number, default: 0 },
    blocked: { type: Boolean, default: false },
    capacity: Number,
  }),
  Audit: new Schema(
    {
      adminClerkId: String,
      userId: objectId,
      action: String,
      reason: String,
      before: Number,
      after: Number,
      appointmentId: { type: objectId, ref: "Appointment" },
      transactionId: { type: objectId, ref: "Transaction" },
      fromStatus: String,
      toStatus: String,
      scheduledBefore: Date,
      scheduledAfter: Date,
      estimatedCompletionBefore: Date,
      estimatedCompletionAfter: Date,
      details: new Schema({
        clientName: String,
        serviceName: String,
        vehicle: new Schema({ model: String, plate: String, type: String }, { _id: false }),
        scheduledAt: Date,
        quotedPrice: Number,
        finalPrice: Number,
        paymentMethod: String,
        walkIn: Boolean,
        financialPreserved: Boolean,
      }, { _id: false }),
    },
    { timestamps: true },
  ),
  RateLimit: new Schema({
    key: { type: String, unique: true },
    count: Number,
    expiresAt: Date,
  }),
  Submission: new Schema({
    key: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    recordId: { type: objectId, required: true },
    kind: { type: String, enum: ["Appointment", "Coupon", "Transaction"], required: true },
  }, { timestamps: true }),
};
schemas.Appointment.index({ scheduledAt: 1, status: 1 });
schemas.Appointment.index({ userId: 1, scheduledAt: -1 });
schemas.Appointment.index({ status: 1, arrivedAt: 1, _id: 1 });
schemas.Appointment.index({ trackingTokenHash: 1 }, { unique: true, sparse: true });
schemas.Audit.index({ appointmentId: 1, createdAt: 1 });
schemas.Audit.index({ createdAt: -1, _id: -1 });
schemas.Audit.index({ action: 1, createdAt: -1 });
schemas.Transaction.index({ date: 1 });
schemas.Transaction.index({ correctionOf: 1, date: 1 });
schemas.Coupon.index({ userId: 1, status: 1 });
schemas.RateLimit.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Schemas constrain storage; Zod constrains untrusted request input at the API boundary.
export const User =
  mongoose.models.User || mongoose.model("User", schemas.User);
export const Service =
  mongoose.models.Service || mongoose.model("Service", schemas.Service);
export const Appointment =
  mongoose.models.Appointment ||
  mongoose.model("Appointment", schemas.Appointment);
export const Coupon =
  mongoose.models.Coupon || mongoose.model("Coupon", schemas.Coupon);
export const Transaction =
  mongoose.models.Transaction ||
  mongoose.model("Transaction", schemas.Transaction);
export const Settings =
  mongoose.models.Settings || mongoose.model("Settings", schemas.Settings);
export const Slot =
  mongoose.models.Slot || mongoose.model("Slot", schemas.Slot);
export const Audit =
  mongoose.models.Audit || mongoose.model("Audit", schemas.Audit);
export const RateLimit =
  mongoose.models.RateLimit || mongoose.model("RateLimit", schemas.RateLimit);
export const Submission = mongoose.models.Submission || mongoose.model("Submission", schemas.Submission);
let connection: Promise<typeof mongoose> | undefined;
export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (!process.env.MONGODB_URI) throw new Error("DATABASE_NOT_CONFIGURED");
  // Optional process-local override when the machine's DNS cannot resolve Atlas SRV.
  // Leave unset in hosting environments with working DNS.
  if (!connection && process.env.MONGODB_DNS_SERVERS)
    setServers(process.env.MONGODB_DNS_SERVERS.split(",").map(value => value.trim()).filter(Boolean));
  connection ??= mongoose
    .connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 7000,
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      waitQueueTimeoutMS: 5000,
      autoIndex: process.env.NODE_ENV !== "production",
    })
    .catch((e) => {
      connection = undefined;
      throw e;
    });
  return connection;
}
