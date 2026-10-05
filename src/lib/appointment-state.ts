// Shared by the server and UI. Only the server commits transitions.
export const appointmentStatuses = ["pending", "confirmed", "arrived", "in_progress", "ready", "completed", "delivered", "rejected", "cancelled", "returned"] as const;
export type AppointmentStatus = typeof appointmentStatuses[number];
export const physicalQueueStatuses = ["arrived", "in_progress", "ready", "completed"] as const;
export const activeAppointmentStatuses = ["pending", "confirmed", "arrived", "in_progress", "ready"] as const;
export const ACTIVE_APPOINTMENT_STATUSES = activeAppointmentStatuses;
export const appointmentTransitions = {
  confirm: { from: ["pending"], to: "confirmed", timestamp: "confirmedAt", label: "Aprovar" },
  arrive: { from: ["confirmed"], to: "arrived", timestamp: "arrivedAt", label: "Registrar chegada" },
  start: { from: ["arrived"], to: "in_progress", timestamp: "startedAt", label: "Iniciar serviço" },
  ready: { from: ["in_progress"], to: "ready", timestamp: "readyAt", label: "Marcar como pronto" },
  complete: { from: ["ready"], to: "completed", timestamp: "completedAt", label: "Registrar pagamento" },
  deliver: { from: ["completed"], to: "delivered", timestamp: "deliveredAt", label: "Registrar entrega" },
  return: { from: ["arrived", "in_progress", "ready"], to: "returned", timestamp: "returnedAt", label: "Registrar devolução" },
  reject: { from: ["pending"], to: "rejected", timestamp: "rejectedAt", label: "Recusar" },
  cancel: { from: ["pending", "confirmed"], to: "cancelled", timestamp: "cancelledAt", label: "Cancelar" },
} as const;
export type TransitionAction = keyof typeof appointmentTransitions;
export function canTransition(status: string, action: TransitionAction) {
  return (appointmentTransitions[action].from as readonly string[]).includes(status);
}
export const operationalActions = ["arrive", "start", "ready", "complete", "deliver"] as const;
export function nextOperationalAction(status: string) {
  return operationalActions.find(action => canTransition(status, action));
}
