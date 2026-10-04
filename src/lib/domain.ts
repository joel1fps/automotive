import { addDays, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIME_ZONE, type VehicleType } from "./catalog";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}
export const localDate = (date: Date) =>
  formatInTimeZone(date, TIME_ZONE, "yyyy-MM-dd");
export function localSlots(
  date: string,
  settings: {
    openingDays: number[];
    openTime: string;
    closeTime: string;
    slotDuration: number;
  },
) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!settings.openingDays.includes(day)) return [];
  const minutes = (s: string) =>
    Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const slots: Date[] = [];
  for (
    let time = minutes(settings.openTime);
    time + settings.slotDuration <= minutes(settings.closeTime);
    time += settings.slotDuration
  ) {
    slots.push(
      fromZonedTime(
        `${date}T${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}:00`,
        TIME_ZONE,
      ),
    );
  }
  return slots;
}
export function validAppointmentTime(
  date: Date,
  settings: Parameters<typeof localSlots>[1],
  now = new Date(),
) {
  return (
    date > now &&
    !!appointmentSlot(date, settings)
  );
}
export function loyaltyStep(current: number, eligible: boolean) {
  assert(
    Number.isInteger(current) && current >= 0 && current < 10,
    "Contador de fidelidade inválido",
  );
  return {
    count: eligible ? (current + 1) % 10 : current,
    issue: eligible && current === 9,
  };
}
export function couponMatches(
  coupon: { vehiclePlate: string; vehicleType: string; expiresAt: Date },
  vehicle: { plate: string; type: VehicleType },
  scheduledAt: Date,
) {
  return (
    coupon.vehiclePlate === vehicle.plate &&
    coupon.vehicleType === vehicle.type &&
    coupon.expiresAt >= scheduledAt
  );
}
export function periodBounds(range: "day" | "week" | "month", date: string) {
  const local = new Date(`${date}T12:00:00Z`);
  const start =
    range === "week"
      ? new Date(+local - ((local.getUTCDay() + 6) % 7) * 86400000)
      : range === "month"
        ? new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 12))
        : local;
  const end =
    range === "month"
      ? new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12),
        )
      : new Date(+start + (range === "week" ? 7 : 1) * 86400000);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: fromZonedTime(`${isoDay(start)}T00:00:00`, TIME_ZONE),
    to: fromZonedTime(`${isoDay(end)}T00:00:00`, TIME_ZONE),
  };
}
export function filterBounds(from: string, to: string) {
  assert(from <= to, "Período inválido");
  return {
    from: fromZonedTime(`${from}T00:00:00`, TIME_ZONE),
    to: fromZonedTime(
      `${addDays(new Date(`${to}T12:00:00Z`), 1)
        .toISOString()
        .slice(0, 10)}T00:00:00`,
      TIME_ZONE,
    ),
  };
}
export const previousBounds = (from: Date, to: Date) => ({
  from: new Date(+from - (+to - +from)),
  to: from,
});
export const cents = (value: number) => Math.round(value * 100);
export function sumMoney(values: number[]) {
  return values.reduce((sum, value) => sum + cents(value), 0) / 100;
}
export const expiryForReward = (now: Date) => addDays(now, 30);
export const previousDay = (now: Date) => subDays(now, 1);

export function appointmentSlot(date: Date, settings: Parameters<typeof localSlots>[1]) {
  return localSlots(localDate(date), settings).find(slot => +date >= +slot && +date < +slot + settings.slotDuration * 60000);
}
