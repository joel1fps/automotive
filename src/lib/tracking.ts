import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Appointment, Audit, connectDB } from "./db";
import { AppError, assert } from "./domain";
import { objectId } from "./validation";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const secretSelection = "+trackingToken +trackingTokenHash";
const unavailable = () => new AppError(404, "Link de acompanhamento indisponível.");
const iso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(+date) ? null : date.toISOString();
};

export const trackingActionSchema = z.object({
  action: z.enum(["generate", "regenerate"], { error: "Escolha gerar ou renovar o link." }),
}).strict();
export const trackingEstimateSchema = z.object({
  estimatedCompletionAt: z.iso.datetime({ offset: true, error: "Informe uma data e horário válidos para a previsão." }).nullable(),
}).strict();

export type AdminTrackingInfo = {
  url: string | null;
  active: boolean;
  estimatedCompletionAt: string | null;
  generatedAt: string | null;
  revokedAt: string | null;
};
type AdminTracking = AdminTrackingInfo;

export type PublicTracking = {
  vehicle: { model: string; plate: string };
  serviceName: string;
  scheduledAt: string | null;
  walkIn: boolean;
  status: string;
  createdAt: string | null;
  confirmedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  estimatedCompletionAt: string | null;
  updatedAt: string | null;
};

type TrackingAppointment = {
  trackingToken?: string;
  trackingTokenHash?: string;
  trackingGeneratedAt?: unknown;
  trackingRevokedAt?: unknown;
  estimatedCompletionAt?: unknown;
};

function adminDto(appointment: TrackingAppointment): AdminTracking {
  const active = Boolean(appointment.trackingToken && appointment.trackingTokenHash && !appointment.trackingRevokedAt);
  return {
    url: active ? `/acompanhar/${appointment.trackingToken}` : null,
    active,
    estimatedCompletionAt: iso(appointment.estimatedCompletionAt),
    generatedAt: iso(appointment.trackingGeneratedAt),
    revokedAt: iso(appointment.trackingRevokedAt),
  };
}

export function trackingTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const validTrackingToken = (token: string) => tokenPattern.test(token);

export async function readPublicTracking(token: string): Promise<PublicTracking> {
  if (!validTrackingToken(token)) throw unavailable();
  await connectDB();
  // Explicit projection and DTO prevent both current and future administrative fields leaking.
  const appointment = await Appointment.findOne({
    trackingTokenHash: trackingTokenHash(token),
    trackingRevokedAt: { $exists: false },
    deletedAt: { $exists: false },
  }).select("vehicle.model vehicle.plate serviceName customDescription scheduledAt walkIn status createdAt confirmedAt arrivedAt startedAt readyAt deliveredAt returnedAt estimatedCompletionAt updatedAt").lean();
  if (!appointment) throw unavailable();
  return {
    vehicle: { model: String(appointment.vehicle?.model || ""), plate: String(appointment.vehicle?.plate || "") },
    serviceName: String(appointment.serviceName || appointment.customDescription || "Serviço automotivo"),
    scheduledAt: iso(appointment.scheduledAt),
    walkIn: Boolean(appointment.walkIn),
    status: String(appointment.status),
    createdAt: iso(appointment.createdAt),
    confirmedAt: iso(appointment.confirmedAt),
    arrivedAt: iso(appointment.arrivedAt),
    startedAt: iso(appointment.startedAt),
    readyAt: iso(appointment.readyAt),
    deliveredAt: iso(appointment.deliveredAt),
    returnedAt: iso(appointment.returnedAt),
    estimatedCompletionAt: iso(appointment.estimatedCompletionAt),
    updatedAt: iso(appointment.updatedAt),
  };
}

export async function readAdminTracking(id: string): Promise<AdminTracking> {
  objectId.parse(id);
  await connectDB();
  const appointment = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } }).select(secretSelection);
  assert(appointment, "Agendamento não encontrado", 404);
  return adminDto(appointment);
}

export async function generateTracking(id: string, action: "generate" | "regenerate", adminClerkId: string): Promise<AdminTracking> {
  objectId.parse(id);
  await connectDB();
  return Appointment.db.transaction(async session => {
    const appointment = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } }).select(secretSelection).session(session);
    assert(appointment, "Agendamento não encontrado", 404);
    if (action === "generate" && adminDto(appointment).active) return adminDto(appointment);
    const token = randomBytes(32).toString("base64url");
    appointment.trackingToken = token;
    appointment.trackingTokenHash = trackingTokenHash(token);
    appointment.trackingGeneratedAt = new Date();
    appointment.trackingRevokedAt = undefined;
    await appointment.save({ session });
    await Audit.create([{
      appointmentId: appointment._id,
      adminClerkId,
      action: action === "regenerate" ? "tracking_regenerated" : "tracking_generated",
      reason: "Link de acompanhamento atualizado",
    }], { session });
    return adminDto(appointment);
  });
}

export async function revokeTracking(id: string, adminClerkId: string): Promise<AdminTracking> {
  objectId.parse(id);
  await connectDB();
  return Appointment.db.transaction(async session => {
    const appointment = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } }).select(secretSelection).session(session);
    assert(appointment, "Agendamento não encontrado", 404);
    if (!adminDto(appointment).active) return adminDto(appointment);
    appointment.trackingToken = undefined;
    appointment.trackingTokenHash = undefined;
    appointment.trackingRevokedAt = new Date();
    await appointment.save({ session });
    await Audit.create([{
      appointmentId: appointment._id,
      adminClerkId,
      action: "tracking_revoked",
      reason: "Link de acompanhamento revogado",
    }], { session });
    return adminDto(appointment);
  });
}

export async function updateTrackingEstimate(id: string, input: unknown, adminClerkId: string): Promise<AdminTracking> {
  objectId.parse(id);
  const parsed = trackingEstimateSchema.parse(input);
  const estimated = parsed.estimatedCompletionAt ? new Date(parsed.estimatedCompletionAt) : undefined;
  assert(!estimated || +estimated > Date.now(), "A previsão de conclusão deve ser futura.");
  await connectDB();
  return Appointment.db.transaction(async session => {
    const appointment = await Appointment.findOne({ _id: id, deletedAt: { $exists: false } }).select(secretSelection).session(session);
    assert(appointment, "Agendamento não encontrado", 404);
    assert(!estimated || !["ready", "completed", "delivered", "cancelled", "rejected", "returned"].includes(appointment.status),
      "Este atendimento já foi finalizado e não aceita previsão de conclusão.", 409);
    assert(!estimated || +estimated >= +appointment.scheduledAt,
      "A previsão de entrega deve ser igual ou posterior ao horário do atendimento.");
    assert(estimated || !appointment.flexibleSchedule || appointment.status !== "confirmed",
      "Agendamentos aprovados precisam manter uma previsão de entrega.", 409);
    const previous = iso(appointment.estimatedCompletionAt);
    const next = iso(estimated);
    if (previous === next) return adminDto(appointment);
    appointment.estimatedCompletionAt = estimated;
    await appointment.save({ session });
    await Audit.create([{
      appointmentId: appointment._id,
      adminClerkId,
      action: "tracking_estimate_updated",
      reason: `Previsão de conclusão: ${previous || "não informada"} → ${next || "não informada"}`,
    }], { session });
    return adminDto(appointment);
  });
}
