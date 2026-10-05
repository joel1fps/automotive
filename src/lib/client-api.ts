"use client";
import { useCallback, useEffect, useRef, useState } from "react";
const RESOURCE_CHANGED = "automotive:resource-changed";
class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function refreshResources() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RESOURCE_CHANGED));
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(data?.error || "Não foi possível completar a operação. Tente novamente.", res.status);
  if (data === null && res.status !== 204)
    throw new Error("Resposta inválida do servidor. Atualize a tela e tente novamente.");
  if (options?.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) refreshResources();
  return data;
}
export function useResource<T>(url: string | null, options: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const loadedUrl = useRef<string | null>(null);
  const pending = useRef(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!url) return;
    const onFocus = () => { if (document.visibilityState === "visible" && navigator.onLine && !pending.current) refresh(); };
    window.addEventListener(RESOURCE_CHANGED, refresh);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = options.pollMs ? window.setInterval(onFocus, options.pollMs) : undefined;
    return () => {
      window.removeEventListener(RESOURCE_CHANGED, refresh);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if (timer) window.clearInterval(timer);
    };
  }, [url, options.pollMs, refresh]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!url) {
      loadedUrl.current = null;
      setData(null);
      setLoading(false);
      return;
    }
    if (loadedUrl.current !== url) { setLoading(true); setData(null); }
    pending.current = true;
    setError("");
    api<T>(url, { signal: controller.signal, cache: "no-store" })
      .then((value) => {
        if (active) { loadedUrl.current = url; setData(value); }
      })
      .catch((e) => {
        if (active) {
          if (e instanceof ApiError && [401, 403].includes(e.status)) {
            loadedUrl.current = null;
            setData(null);
          }
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) { pending.current = false; setLoading(false); }
      });
    return () => {
      active = false;
      pending.current = false;
      controller.abort();
    };
  }, [url, version]);
  return {
    data,
    loading,
    error,
    refresh,
  };
}
export type ServiceItem = {
  _id: string;
  name: string;
  slug: string;
  category: "wash" | "extra";
  prices: { small: number; suv: number; pickup: number; moto?: number } | null;
  imageUrl?: string;
  vehicleTypes?: string[];
  startingPrice?: number;
  countsForLoyalty: boolean;
  active: boolean;
  description: string;
};
export type AppointmentItem = {
  _id: string;
  userId?: string | Pick<ClientItem, "_id" | "name" | "email" | "phone"> | null;
  guestName?: string;
  guestPhone?: string;
  vehicle: { model: string; plate: string; type: "small" | "suv" | "pickup" | "moto" };
  serviceName: string;
  scheduledAt: string;
  status: string;
  quotedPrice: number | null;
  finalPrice?: number;
  couponId?: string;
  notes: string;
  rejectionReason?: string;
  walkIn?: boolean;
  flexibleSchedule?: boolean;
  arrivedAt?: string;
  startedAt?: string;
  readyAt?: string;
  completedAt?: string;
  deliveredAt?: string;
  returnedAt?: string;
  returnReason?: string;
  confirmedAt?: string;
  estimatedCompletionAt?: string;
  queuePosition?: number;
};
export const appointmentClient = (appointment: AppointmentItem) => {
  const customer = typeof appointment.userId === "object" ? appointment.userId : null;
  return { name: customer?.name || appointment.guestName || "Cliente", phone: customer?.phone || appointment.guestPhone || "" };
};
export type CouponItem = {
  _id: string;
  userId: string;
  status: string;
  vehiclePlate: string;
  vehicleType: string;
  expiresAt: string;
  issuedAt: string;
  reservedAppointmentId?: string;
};
export type ClientItem = {
  role?: string;
  _id: string;
  name: string;
  email: string;
  phone?: string;
  loyaltyCount: number;
  totalWashes: number;
  vehicles: {
    model: string;
    plate: string;
    type: "small" | "suv" | "pickup" | "moto";
  }[];
};
export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  pages: number;
};
export type LoyaltyData = {
  loyaltyCount: number;
  totalWashes: number;
  vehicles: ClientItem["vehicles"];
  coupons: CouponItem[];
};
export const dateNow = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
export const displayDate = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
