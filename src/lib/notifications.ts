import { assert } from "./domain";
export function notificationText(appointment: { status: string; serviceName: string; vehicle: { model: string; plate: string } }) {
  const ready = ["ready", "completed"].includes(appointment.status);
  assert(ready || appointment.status === "in_progress", "A mensagem está disponível após iniciar ou marcar o serviço como pronto");
  return `Olá! Aqui é da Automotive. ${ready ? "Seu veículo está pronto para retirada" : "Começamos agora o serviço"}: ${appointment.serviceName}, ${appointment.vehicle.model} (${appointment.vehicle.plate}). ${ready ? "Pode vir buscar. Agradecemos a preferência!" : "Avisaremos quando estiver pronto. Obrigado pela confiança!"}`;
}
