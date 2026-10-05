import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatTrackingDate, trackingEstimate, trackingStage, trackingStatusLabel, trackingTimeline,
  type VehicleTrackingData,
} from "../src/lib/tracking-state";

const base: VehicleTrackingData = {
  vehicle: { model: "Onix", plate: "ABC1D23" }, serviceName: "Lavagem simples",
  scheduledAt: "2026-10-04T14:00:00.000Z", status: "pending", createdAt: "2026-10-03T14:00:00.000Z",
};

test("Acompanhamento usa as seis etapas operacionais, sem expor o fechamento financeiro", () => {
  const cases = { pending: 0, confirmed: 1, arrived: 2, in_progress: 3, ready: 4, completed: 4, delivered: 5 };
  for (const [status, stage] of Object.entries(cases)) {
    assert.equal(trackingStage(status), stage, status);
    const timeline = trackingTimeline({ ...base, status: status as VehicleTrackingData["status"] });
    assert.equal(timeline.length, 6);
    assert.equal(timeline.filter(step => step.state === "current").length, 1);
    assert.equal(timeline[stage].state, "current");
    assert.equal(timeline.slice(stage + 1).every(step => step.state === "upcoming"), true);
  }
  assert.equal(trackingStatusLabel("completed"), "Serviço concluído");
  assert.equal(trackingStatusLabel("ready"), trackingStatusLabel("completed"));
});

test("Histórico antigo não inventa horários e chegada direta reutiliza a mesma linha do tempo", () => {
  const legacy = trackingTimeline({ ...base, status: "ready", createdAt: undefined });
  assert.equal(legacy[0].state, "complete");
  assert.equal(legacy.every(step => step.recordedAt === null), true);
  const instant = "2026-10-04T13:00:00.000Z";
  const walkIn = trackingTimeline({ ...base, status: "arrived", walkIn: true, createdAt: instant, confirmedAt: instant, arrivedAt: instant });
  assert.deepEqual(walkIn.slice(0, 3).map(step => step.recordedAt), [instant, instant, instant]);
  assert.deepEqual(walkIn.slice(0, 3).map(step => step.state), ["complete", "complete", "current"]);
});

test("Cancelamento e recusa não marcam etapas futuras como concluídas", () => {
  for (const status of ["cancelled", "rejected"] as const) {
    const timeline = trackingTimeline({ ...base, status });
    assert.equal(trackingStage(status), null);
    assert.equal(timeline[0].state, "complete");
    assert.equal(timeline.slice(1).every(step => step.state === "upcoming"), true);
    assert.equal(timeline.some(step => step.state === "current"), false);
    assert.equal(trackingEstimate({ ...base, status }), null);
  }
  assert.equal(trackingStage("unknown"), null);
  assert.equal(trackingStatusLabel("unknown"), "Status indisponível");
});

test("Datas são exibidas em Fortaleza mesmo quando o navegador estiver em outro fuso", () => {
  assert.equal(formatTrackingDate("2026-10-05T01:25:00.000Z"), "04/10/2026, 22:25");
  assert.equal(formatTrackingDate("data-inválida"), null);
  assert.equal(formatTrackingDate(null), null);
});
test("Devolução mostra apenas etapas registradas, sem inventar conclusão do serviço", () => {
  const data: VehicleTrackingData = { ...base, status: "returned", confirmedAt: "2026-10-04T12:00:00Z", arrivedAt: "2026-10-04T13:00:00Z",
    returnedAt: "2026-10-04T14:00:00Z", estimatedCompletionAt: "2026-10-04T15:00:00Z" };
  const timeline = trackingTimeline(data);
  assert.equal(trackingStage("returned"), null);
  assert.equal(trackingStatusLabel("returned"), "Veículo devolvido sem fechamento");
  assert.equal(timeline[2].state, "complete");
  assert.equal(timeline[3].state, "upcoming");
  assert.equal(timeline[4].state, "upcoming");
  assert.equal(timeline[5].title, "Veículo devolvido");
  assert.equal(timeline[5].recordedAt, data.returnedAt);
  assert.equal(timeline[5].state, "complete");
  assert.equal(timeline.some(step => step.state === "current"), false);
  assert.equal(trackingEstimate(data), null);
  const alreadyReady = trackingTimeline({ ...data, startedAt: "2026-10-04T13:10:00Z", readyAt: "2026-10-04T13:50:00Z" });
  assert.equal(alreadyReady[4].state, "complete", "Não apaga uma conclusão que realmente foi registrada");
});

test("Previsão distingue ausência e atraso sem prometer horário ou inventar duração", () => {
  const now = Date.parse("2026-10-04T15:00:00.000Z");
  assert.equal(trackingEstimate(base, now)?.date, null);
  assert.equal(trackingEstimate({ ...base, estimatedCompletionAt: "invalid" }, now)?.date, null);
  const earlier = trackingEstimate({ ...base, estimatedCompletionAt: "2026-10-04T14:30:00.000Z" }, now);
  assert.equal(earlier?.overdue, true);
  const later = trackingEstimate({ ...base, estimatedCompletionAt: "2026-10-04T15:30:00.000Z" }, now);
  assert.equal(later?.overdue, false);
  for (const status of ["ready", "completed", "delivered"] as const) {
    assert.equal(trackingEstimate({ ...base, status, estimatedCompletionAt: "2026-10-04T14:30:00.000Z" }, now), null);
  }
});
