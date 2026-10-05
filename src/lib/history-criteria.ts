// The same vocabulary is used by the API and the administrator's history filter.
export const historyCriteria = ["scheduled", "arrived", "ready", "delivered"] as const;
export type HistoryCriterion = typeof historyCriteria[number];
export const historyCriterionLabels: Record<HistoryCriterion, string> = {
  scheduled: "Data agendada",
  arrived: "Entrada do veículo",
  ready: "Conclusão do serviço",
  delivered: "Entrega / devolução do veículo",
};
