"use client";
import { useCallback, useEffect, useState } from "react";
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "Não foi possível completar a operação");
  return data;
}
export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api<T>(url)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, version]);
  return {
    data,
    loading,
    error,
    refresh: useCallback(() => setVersion((v) => v + 1), []),
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
  userId?: string;
  guestName?: string;
  vehicle: { model: string; plate: string; type: "small" | "suv" | "pickup" | "moto" };
  serviceName: string;
  scheduledAt: string;
  status: string;
  quotedPrice: number;
  finalPrice?: number;
  couponId?: string;
  notes: string;
  rejectionReason?: string;
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
