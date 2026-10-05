export const auditLabels: Record<string, string> = {
  appointment_deleted: "Agendamento excluído",
  booking_created: "Agendamento criado",
  walk_in: "Chegada avulsa registrada",
  confirm: "Agendamento aprovado",
  reject: "Agendamento recusado",
  cancel: "Agendamento cancelado",
  arrive: "Veículo recebido",
  start: "Serviço iniciado",
  ready: "Serviço concluído",
  complete: "Pagamento registrado",
  deliver: "Veículo entregue",
  reschedule: "Agendamento reagendado",
  tracking_generated: "Link de acompanhamento gerado",
  tracking_regenerated: "Link de acompanhamento renovado",
  tracking_revoked: "Link de acompanhamento revogado",
  tracking_estimate_updated: "Previsão de conclusão alterada",
  loyalty_adjustment: "Fidelidade ajustada",
  manual_coupon: "Cupom criado",
  manual_transaction: "Lançamento avulso criado",
  payment_corrected: "Pagamento corrigido",
  payment_refunded: "Pagamento estornado",
  return: "Devolução registrada",
  role_change: "Permissão alterada",
  catalog_reset: "Catálogo restaurado",
  email_notification: "Aviso por e-mail registrado",
};

export function auditLabel(action: string) {
  return Object.hasOwn(auditLabels, action) ? auditLabels[action] : action;
}
