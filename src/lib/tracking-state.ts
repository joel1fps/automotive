import type { AppointmentStatus } from "./appointment-state";

/** The public page deliberately has no customer, price, payment or internal notes. */
export type VehicleTrackingData = {
  vehicle: { model: string; plate: string };
  serviceName: string;
  scheduledAt: string | null;
  walkIn?: boolean;
  status: AppointmentStatus;
  createdAt?: string | null;
  confirmedAt?: string | null;
  arrivedAt?: string | null;
  startedAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  returnedAt?: string | null;
  estimatedCompletionAt?: string | null;
  updatedAt?: string | null;
};

type TrackingTimestamp = "createdAt" | "confirmedAt" | "arrivedAt" | "startedAt" | "readyAt" | "deliveredAt";
export const trackingSteps: ReadonlyArray<{ title: string; description: string; timestamp: TrackingTimestamp }> = [
  { title: "Agendamento realizado", description: "O atendimento foi cadastrado.", timestamp: "createdAt" },
  { title: "Agendamento aprovado", description: "A equipe confirmou o atendimento.", timestamp: "confirmedAt" },
  { title: "Veículo recebido", description: "Seu veículo está na Automotive.", timestamp: "arrivedAt" },
  { title: "Serviço em andamento", description: "A equipe está cuidando do seu veículo.", timestamp: "startedAt" },
  { title: "Serviço concluído", description: "O veículo está pronto para retirada.", timestamp: "readyAt" },
  { title: "Veículo entregue", description: "O atendimento foi encerrado.", timestamp: "deliveredAt" },
];

const publicStage: Partial<Record<AppointmentStatus, number>> = {
  pending: 0,
  confirmed: 1,
  arrived: 2,
  in_progress: 3,
  ready: 4,
  // Payment is an administrative transition, not a new public service stage.
  completed: 4,
  delivered: 5,
};

export function trackingStage(status: string): number | null {
  return publicStage[status as AppointmentStatus] ?? null;
}

export function trackingStatusLabel(status: string) {
  if (status === "cancelled") return "Agendamento cancelado";
  if (status === "rejected") return "Agendamento não aprovado";
  if (status === "returned") return "Veículo devolvido sem fechamento";
  const stage = trackingStage(status);
  return stage === null ? "Status indisponível" : trackingSteps[stage].title;
}

export function trackingTimeline(data: VehicleTrackingData) {
  const currentStage = trackingStage(data.status);
  return trackingSteps.map((step, index) => {
    const recordedAt = validTrackingDate(data.status === "returned" && index === 5 ? data.returnedAt : data[step.timestamp]);
    const state: "complete" | "current" | "upcoming" = currentStage === index
      ? "current"
      : currentStage !== null && index < currentStage || currentStage === null && recordedAt
        ? "complete"
        : "upcoming";
    return { ...step, ...(data.status === "returned" && index === 5 ? { title: "Veículo devolvido", description: "A equipe registrou a devolução do veículo." } : {}), recordedAt, state };
  });
}

export function validTrackingDate(value?: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

export function formatTrackingDate(value?: string | null): string | null {
  const valid = validTrackingDate(value);
  if (!valid) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(valid));
}

export function trackingEstimate(data: VehicleTrackingData, now = Date.now()) {
  const stage = trackingStage(data.status);
  if (stage !== null && stage >= 4 || data.status === "cancelled" || data.status === "rejected" || data.status === "returned") return null;
  const date = validTrackingDate(data.estimatedCompletionAt);
  if (!date) return { date: null, overdue: false, message: "A equipe ainda não informou uma previsão." };
  const overdue = Date.parse(date) < now;
  return {
    date,
    overdue,
    message: overdue
      ? "A previsão informada passou. Aguarde uma atualização da equipe."
      : "Horário estimado pela equipe. A previsão pode ser atualizada durante o serviço.",
  };
}
