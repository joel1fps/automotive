"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Car, Check, CircleCheck, Clock3, Droplets, Flag, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import {
  formatTrackingDate, trackingEstimate, trackingStage, trackingStatusLabel, trackingTimeline,
  type VehicleTrackingData,
} from "@/lib/tracking-state";
import styles from "./vehicle-tracking.module.css";

const stepIcons = [CalendarDays, CircleCheck, Car, Droplets, Sparkles, Flag];

function useVehicleTracking(token: string) {
  const [data, setData] = useState<VehicleTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let mounted = true;
    let blocked = false;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(null);
    setLoading(true);
    setUnavailable(false);
    setConnectionError(false);

    function schedule() {
      if (timer) clearTimeout(timer);
      if (mounted && !blocked && document.visibilityState === "visible") {
        timer = setTimeout(() => { void refresh(); }, 10_000);
      }
    }

    async function refresh() {
      if (!mounted || request || document.visibilityState !== "visible") return;
      blocked = false;
      const controller = new AbortController();
      request = controller;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/tracking/${encodeURIComponent(token)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!mounted || controller.signal.aborted) return;
        if (response.status === 404 || response.status === 410) {
          blocked = true;
          setData(null);
          setUnavailable(true);
          setConnectionError(false);
          return;
        }
        if (!response.ok) throw new Error("unavailable");
        const value: VehicleTrackingData = await response.json();
        if (!mounted || controller.signal.aborted) return;
        setData(value);
        setUnavailable(false);
        setConnectionError(false);
      } catch {
        if (mounted && !controller.signal.aborted) setConnectionError(true);
      } finally {
        if (request === controller) request = null;
        if (mounted) {
          setLoading(false);
          setRefreshing(false);
          schedule();
        }
      }
    }

    function resume() {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        request?.abort();
        return;
      }
      void refresh();
    }

    refreshRef.current = () => { void refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    void refresh();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [token]);

  return { data, loading, unavailable, connectionError, refreshing, refresh: () => refreshRef.current() };
}

export function VehicleTracking({ token }: { token: string }) {
  const { data, loading, unavailable, connectionError, refreshing, refresh } = useVehicleTracking(token);
  const current = data ? trackingStage(data.status) : null;
  const timeline = data ? trackingTimeline(data) : [];
  const estimate = data ? trackingEstimate(data) : null;
  const isClosed = data?.status === "cancelled" || data?.status === "rejected";
  const status = data ? trackingStatusLabel(data.status) : "";
  const statusDetail = data?.status === "delivered"
    ? "Obrigado por confiar seu veículo à Automotive."
    : isClosed
      ? "Entre em contato com a equipe para mais informações sobre este atendimento."
      : current === null ? "Aguarde uma atualização da equipe." : timeline[current].description;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}><Droplets size={23} aria-hidden="true" /><span>Automotive</span></div>
          <span className={styles.privateLabel}><ShieldCheck size={15} aria-hidden="true" /> Acompanhamento exclusivo</span>
        </header>

        <div className={styles.intro}>
          <p className={styles.eyebrow}>SEU VEÍCULO, ETAPA POR ETAPA</p>
          <h1>Acompanhe seu atendimento</h1>
          <p>Veja o andamento do serviço. As informações são atualizadas automaticamente enquanto esta página estiver aberta.</p>
        </div>

        <p className={styles.screenReaderOnly} role="status" aria-live="polite" aria-atomic="true">
          {loading ? "Carregando acompanhamento." : unavailable ? "Link de acompanhamento indisponível." : data ? `Status do veículo: ${status}.` : connectionError ? "Não foi possível carregar o acompanhamento." : ""}
        </p>

        {loading ? (
          <section className={styles.empty} aria-busy="true" aria-label="Carregando acompanhamento">
            <Car size={34} aria-hidden="true" />
            <h2>Buscando seu veículo</h2>
            <p>Estamos carregando os detalhes do atendimento.</p>
          </section>
        ) : unavailable ? (
          <section className={styles.empty}>
            <ShieldCheck size={34} aria-hidden="true" />
            <h2>Link indisponível</h2>
            <p>Este link não está disponível. Solicite um novo link de acompanhamento à equipe da Automotive.</p>
          </section>
        ) : !data ? (
          <section className={styles.empty}>
            <AlertCircle size={34} aria-hidden="true" />
            <h2>Não foi possível conectar</h2>
            <p>Confira sua conexão. Tentaremos carregar o acompanhamento novamente.</p>
            <button className={styles.retry} onClick={refresh} disabled={refreshing}><RefreshCw size={16} aria-hidden="true" /> Tentar novamente</button>
          </section>
        ) : (
          <>
            {connectionError && <div className={styles.connectionWarning} role="status"><AlertCircle size={18} aria-hidden="true" /><p>Conexão temporariamente indisponível. Exibimos as últimas informações recebidas e tentaremos atualizar novamente.</p></div>}
            <section className={styles.statusCard} aria-labelledby="vehicle-status">
              <div className={styles.vehicleSummary}>
                <span className={styles.vehicleIcon}><Car size={31} aria-hidden="true" /></span>
                <div>
                  <p className={styles.cardLabel}>Seu veículo</p>
                  <h2>{data.vehicle.model}</h2>
                  <p className={styles.plate}>{data.vehicle.plate}</p>
                </div>
              </div>
              <div className={styles.currentStatus} data-closed={isClosed || undefined}>
                <span className={styles.statusKicker}><span className={styles.statusDot} aria-hidden="true" /> Status atual</span>
                <h3 id="vehicle-status">{status}</h3>
                <p>{statusDetail}</p>
              </div>
            </section>

            <div className={styles.detailsGrid}>
              <section className={styles.detail} aria-labelledby="tracking-service"><Sparkles size={21} aria-hidden="true" /><div><h3 id="tracking-service">Serviço contratado</h3><p>{data.serviceName}</p></div></section>
              <section className={styles.detail} aria-labelledby="tracking-schedule"><CalendarDays size={21} aria-hidden="true" /><div><h3 id="tracking-schedule">{data.walkIn ? "Atendimento presencial" : "Data do agendamento"}</h3><p>{formatTrackingDate(data.scheduledAt) || "Horário não registrado"}</p>{data.walkIn && <small>Entrada sem agendamento prévio</small>}</div></section>
              {estimate && <section className={`${styles.detail} ${styles.estimate}`} aria-labelledby="tracking-estimate" data-overdue={estimate.overdue || undefined}><Clock3 size={21} aria-hidden="true" /><div><h3 id="tracking-estimate">Previsão de conclusão</h3><p>{estimate.date ? formatTrackingDate(estimate.date) : "Aguardando previsão"}</p><small>{estimate.message}</small></div></section>}
            </div>

            <section className={styles.timelineSection} aria-labelledby="tracking-timeline">
              <div className={styles.timelineHeading}><div><p className={styles.eyebrow}>ANDAMENTO DO SERVIÇO</p><h2 id="tracking-timeline">Cada etapa do cuidado</h2></div>{current !== null && <span className={styles.stepCount}>Etapa {current + 1} de 6</span>}</div>
              <ol className={styles.timeline}>
                {timeline.map((step, index) => {
                  const Icon = stepIcons[index];
                  return (
                    <li key={step.title} className={styles.timelineStep} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
                      <div className={styles.stepIcon} aria-hidden="true">{step.state === "complete" ? <Check size={21} /> : <Icon size={21} />}</div>
                      <div className={styles.stepBody}><div className={styles.stepTitle}><h3>{step.title}</h3>{step.state === "current" && <span>Agora</span>}</div><p>{step.description}</p>
                        {step.recordedAt ? <time dateTime={step.recordedAt}>{formatTrackingDate(step.recordedAt)}</time> : <small>{step.state === "upcoming" ? isClosed ? "Etapa não realizada" : "Aguardando esta etapa" : "Horário não registrado"}</small>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
            <div className={styles.updateNote}><RefreshCw size={14} aria-hidden="true" /><p>Atualização automática a cada 10 segundos.{formatTrackingDate(data.updatedAt) && <> Última alteração: <time dateTime={data.updatedAt || undefined}>{formatTrackingDate(data.updatedAt)}</time>.</>}</p></div>
          </>
        )}

        <footer className={styles.footer}><ShieldCheck size={15} aria-hidden="true" /><p>Este link permite apenas consultar este atendimento. Compartilhe somente com pessoas de sua confiança.</p><span>Horários de Fortaleza · UTC−3</span></footer>
      </div>
    </main>
  );
}
